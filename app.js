// app.js
// Main application logic with Transition Detection Engine support

class TradeFlowApp {
    constructor() {
        this.audioEngine = new AudioEngine();
        this.vuMeter = new VUMeter('vu-meter-canvas');
        this.dataPlayer = new DataPlayer();

        // WebSocket state
        this.websocket = null;
        this.connectionStatus = 'disconnected';
        this.dataMode = 'websocket';  // 'websocket' or 'playback'

        // Audio alert mode: 'raw', 'intelligent', or 'transition'
        this.audioAlertMode = 'intelligent';

        // Order aggregation
        this.aggregateOrders = false;      // Toggle to combine same-timestamp orders
        this.aggregationBuffer = new Map(); // timestamp+side -> accumulated volume
        this.aggregationTimeout = null;

        // Engines
        this.eventEngine = null;           // Intelligent mode (continuous flow)
        this.transitionEngine = null;      // Transition detection mode
        this.initializeEngines();

        // Stats
        this.stats = {
            sellCount: 0,
            buyCount: 0,
            sellVolume: 0,
            buyVolume: 0,
            startTime: null
        };

        this.initializeUI();
        this.startStatsUpdate();
        this.connectWebSocket();
    }

    // -----------------------------
    // Defaults + persistence
    // -----------------------------
    getDefaultEventEngineConfig() {
        return {
            windowMs: 300,
            dominanceMetric: 'volume',
            enterDominance: 0.80,
            exitDominance: 0.65,
            minTradesPerSec: 35,
            maxEventsPerSec: 8,
            requireSustainedMs: 80,
            lockSideMs: 150,
            cooldownMs: 0
        };
    }

    getDefaultTransitionEngineConfig() {
        return {
            windowMs: 1000,
            dominanceMetric: 'volume',
            thrustThreshold: 0.60,
            thrustChange: 0.30,
            thrustMinVelocity: 20,
            pullbackThreshold: 0.30,
            pullbackFade: 0.20,
            absorptionThreshold: 0.20,
            absorptionMinVelocity: 20,
            absorptionMinTrades: 15,
            minEventInterval: 500,
            historyDepth: 3
        };
    }

    loadSettings() {
        try {
            const raw = localStorage.getItem('tradeflow_settings');
            if (!raw) return null;
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }

    saveSettings(settings) {
        localStorage.setItem('tradeflow_settings', JSON.stringify(settings));
    }

    // -----------------------------
    // Engine initialization
    // -----------------------------
    initializeEngines() {
        // Initialize EventEngine (intelligent mode)
        if (typeof EventEngine !== 'undefined') {
            const saved = this.loadSettings();
            const defaults = this.getDefaultEventEngineConfig();

            const eventConfig = {
                ...defaults,
                ...(saved?.eventEngineConfig || {}),
                minTotalVolumeInWindow: 0,
                debug: false
            };

            this.eventEngine = new EventEngine(eventConfig);
        } else {
            console.warn('EventEngine not found. Ensure event-engine.js is loaded.');
        }

        // Initialize TransitionDetectionEngine (transition mode)
        if (typeof TransitionDetectionEngine !== 'undefined') {
            const saved = this.loadSettings();
            const defaults = this.getDefaultTransitionEngineConfig();

            const transitionConfig = {
                ...defaults,
                ...(saved?.transitionEngineConfig || {}),
                debug: false
            };

            this.transitionEngine = new TransitionDetectionEngine(transitionConfig);
        } else {
            console.warn('TransitionDetectionEngine not found. Ensure transition-detection-engine.js is loaded.');
        }

        // Load audio mode preference
        const saved = this.loadSettings();
        if (saved?.audioAlertMode) {
            this.audioAlertMode = saved.audioAlertMode;
        }
        if (saved?.aggregateOrders !== undefined) {
            this.aggregateOrders = saved.aggregateOrders;
        }
    }

    // -----------------------------
    // UI initialization
    // -----------------------------
    initializeUI() {
        // Enable audio on first click (autoplay policy)
        document.addEventListener('click', () => {
            if (!this.audioEngine.isInitialized) {
                this.audioEngine.init();
                console.log('Audio enabled');
            }
        }, { once: true });

        // Audio mode selector
        const audioModeSelect = document.getElementById('audio-alert-mode');
        if (audioModeSelect) {
            audioModeSelect.value = this.audioAlertMode;
            audioModeSelect.addEventListener('change', (e) => {
                this.audioAlertMode = e.target.value;
                this.updateSettingsSectionsVisibility();
                this.saveSettings({
                    audioAlertMode: this.audioAlertMode,
                    aggregateOrders: this.aggregateOrders,
                    eventEngineConfig: this.eventEngine?.config || this.getDefaultEventEngineConfig(),
                    transitionEngineConfig: this.transitionEngine?.config || this.getDefaultTransitionEngineConfig()
                });
            });
        }

        // Aggregate orders toggle
        const aggregateCheckbox = document.getElementById('aggregate-orders');
        if (aggregateCheckbox) {
            aggregateCheckbox.checked = this.aggregateOrders;
            aggregateCheckbox.addEventListener('change', (e) => {
                this.aggregateOrders = e.target.checked;
                this.saveSettings({
                    audioAlertMode: this.audioAlertMode,
                    aggregateOrders: this.aggregateOrders,
                    eventEngineConfig: this.eventEngine?.config || this.getDefaultEventEngineConfig(),
                    transitionEngineConfig: this.transitionEngine?.config || this.getDefaultTransitionEngineConfig()
                });
                console.log('Order aggregation:', this.aggregateOrders ? 'enabled' : 'disabled');
            });
        }

        // Master volume control
        const volumeSlider = document.getElementById('master-volume');
        const volumeValue = document.getElementById('volume-value');

        if (volumeSlider && volumeValue) {
            volumeSlider.addEventListener('input', (e) => {
                const pct = parseInt(e.target.value, 10);
                const x = pct / 100;
                const curved = Math.pow(x, 1.6);
                this.audioEngine.setVolume(curved);
                volumeValue.textContent = e.target.value + '%';
            });
        }

        // BID frequency control
        const bidFreqSlider = document.getElementById('bid-frequency');
        const bidFreqValue = document.getElementById('bid-freq-value');

        if (bidFreqSlider && bidFreqValue) {
            bidFreqSlider.addEventListener('input', (e) => {
                const freq = parseInt(e.target.value, 10);
                this.audioEngine.setBidFrequency(freq);
                bidFreqValue.textContent = freq + ' Hz';
            });
        }

        // ASK frequency control
        const askFreqSlider = document.getElementById('ask-frequency');
        const askFreqValue = document.getElementById('ask-freq-value');

        if (askFreqSlider && askFreqValue) {
            askFreqSlider.addEventListener('input', (e) => {
                const freq = parseInt(e.target.value, 10);
                this.audioEngine.setAskFrequency(freq);
                askFreqValue.textContent = freq + ' Hz';
            });
        }

        // Sensitivity control
        const sensitivitySlider = document.getElementById('sensitivity');
        const sensitivityValue = document.getElementById('sensitivity-value');

        if (sensitivitySlider && sensitivityValue) {
            sensitivitySlider.addEventListener('input', (e) => {
                const sensitivity = parseInt(e.target.value, 10) / 100;
                this.vuMeter.setSensitivity(sensitivity);
                sensitivityValue.textContent = e.target.value + '%';
            });
        }

        // Data mode toggle (Live / Playback)
        const modeToggle = document.getElementById('data-mode');
        if (modeToggle) {
            modeToggle.addEventListener('change', (e) => {
                this.dataMode = e.target.value;
                this.updateUIForMode();
            });
        }

        // Playback controls
        const playBtn = document.getElementById('play-btn');
        const pauseBtn = document.getElementById('pause-btn');
        const stopBtn = document.getElementById('stop-btn');

        if (playBtn) playBtn.addEventListener('click', () => this.handlePlay());
        if (pauseBtn) pauseBtn.addEventListener('click', () => this.handlePause());
        if (stopBtn) stopBtn.addEventListener('click', () => this.handleStop());

        // File upload
        const csvInput = document.getElementById('csv-file');
        if (csvInput) {
            csvInput.addEventListener('change', (e) => {
                this.handleFileUpload(e.target.files[0]);
            });
        }

        // Speed control
        const speedSlider = document.getElementById('playback-speed');
        const speedValue = document.getElementById('speed-value');

        if (speedSlider && speedValue) {
            speedSlider.addEventListener('input', (e) => {
                const speed = parseFloat(e.target.value);
                this.dataPlayer.setPlaybackSpeed(speed);
                speedValue.textContent = speed.toFixed(1) + 'x';
            });
        }

        // Reset stats button
        const resetBtn = document.getElementById('reset-stats-btn');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                this.resetStats();
                this.updateStatsDisplay();
            });
        }

        // WebSocket reconnect button
        const reconnectBtn = document.getElementById('reconnect-btn');
        if (reconnectBtn) {
            reconnectBtn.addEventListener('click', () => {
                this.connectWebSocket();
            });
        }

        this.updateUIForMode();

        // Settings drawer
        this.initializeSettingsDrawer();
        this.populateSettingsUIFromCurrent();
        this.updateSettingsSectionsVisibility();
    }

    updateUIForMode() {
        const playbackControls = document.getElementById('playback-controls');
        const websocketStatus = document.getElementById('websocket-status');

        if (!playbackControls || !websocketStatus) return;

        if (this.dataMode === 'websocket') {
            playbackControls.style.display = 'none';
            websocketStatus.style.display = 'flex';
        } else {
            playbackControls.style.display = 'block';
            websocketStatus.style.display = 'none';
        }
    }

    updateSettingsSectionsVisibility() {
        const intelligentSection = document.getElementById('intelligent-settings');
        const transitionSection = document.getElementById('transition-settings');

        if (intelligentSection) {
            intelligentSection.classList.toggle('active', this.audioAlertMode === 'intelligent');
        }

        if (transitionSection) {
            transitionSection.classList.toggle('active', this.audioAlertMode === 'transition');
        }
    }

    // -----------------------------
    // Settings drawer
    // -----------------------------
    initializeSettingsDrawer() {
        const openBtn = document.getElementById('open-settings-btn');
        const closeBtn = document.getElementById('close-settings-btn');
        const overlay = document.getElementById('settings-overlay');
        const drawer = document.getElementById('settings-drawer');

        const applyBtn = document.getElementById('apply-settings-btn');
        const resetBtn = document.getElementById('reset-settings-btn');

        if (!overlay || !drawer) return;

        const openDrawer = () => {
            overlay.style.display = 'block';
            drawer.classList.add('open');
            drawer.setAttribute('aria-hidden', 'false');
        };

        const closeDrawer = () => {
            overlay.style.display = 'none';
            drawer.classList.remove('open');
            drawer.setAttribute('aria-hidden', 'true');
        };

        if (openBtn) openBtn.addEventListener('click', openDrawer);
        if (closeBtn) closeBtn.addEventListener('click', closeDrawer);
        if (overlay) overlay.addEventListener('click', closeDrawer);

        if (applyBtn) {
            applyBtn.addEventListener('click', () => {
                this.applySettings();
                closeDrawer();
            });
        }

        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                this.resetSettingsToDefaults();
                this.populateSettingsUIFromCurrent();
            });
        }
    }

    populateSettingsUIFromCurrent() {
        // Populate EventEngine settings
        if (this.eventEngine) {
            const cfg = this.eventEngine.config || this.getDefaultEventEngineConfig();
            this.setInputValue('engine-windowMs', cfg.windowMs);
            this.setInputValue('engine-dominanceMetric', cfg.dominanceMetric);
            this.setInputValue('engine-enterDominance', cfg.enterDominance);
            this.setInputValue('engine-exitDominance', cfg.exitDominance);
            this.setInputValue('engine-minTradesPerSec', cfg.minTradesPerSec);
            this.setInputValue('engine-maxEventsPerSec', cfg.maxEventsPerSec);
            this.setInputValue('engine-requireSustainedMs', cfg.requireSustainedMs);
            this.setInputValue('engine-lockSideMs', cfg.lockSideMs);
            this.setInputValue('engine-cooldownMs', cfg.cooldownMs);
        }

        // Populate TransitionEngine settings
        if (this.transitionEngine) {
            const cfg = this.transitionEngine.config || this.getDefaultTransitionEngineConfig();
            this.setInputValue('transition-windowMs', cfg.windowMs);
            this.setInputValue('transition-dominanceMetric', cfg.dominanceMetric);
            this.setInputValue('transition-thrustThreshold', cfg.thrustThreshold);
            this.setInputValue('transition-thrustChange', cfg.thrustChange);
            this.setInputValue('transition-thrustMinVelocity', cfg.thrustMinVelocity);
            this.setInputValue('transition-pullbackThreshold', cfg.pullbackThreshold);
            this.setInputValue('transition-pullbackFade', cfg.pullbackFade);
            this.setInputValue('transition-absorptionThreshold', cfg.absorptionThreshold);
            this.setInputValue('transition-minEventInterval', cfg.minEventInterval);
            this.setInputValue('transition-historyDepth', cfg.historyDepth);
        }

        // Set audio mode dropdown
        const audioModeSelect = document.getElementById('audio-alert-mode');
        if (audioModeSelect) {
            audioModeSelect.value = this.audioAlertMode;
        }
    }

    setInputValue(id, value) {
        const el = document.getElementById(id);
        if (el) el.value = value;
    }

    getInputValue(id) {
        const el = document.getElementById(id);
        if (!el) return null;
        if (el.type === 'number') return parseFloat(el.value);
        return el.value;
    }

    applySettings() {
        // Collect EventEngine settings
        const eventEngineConfig = {
            windowMs: this.getInputValue('engine-windowMs'),
            dominanceMetric: this.getInputValue('engine-dominanceMetric'),
            enterDominance: this.getInputValue('engine-enterDominance'),
            exitDominance: this.getInputValue('engine-exitDominance'),
            minTradesPerSec: this.getInputValue('engine-minTradesPerSec'),
            maxEventsPerSec: this.getInputValue('engine-maxEventsPerSec'),
            requireSustainedMs: this.getInputValue('engine-requireSustainedMs'),
            lockSideMs: this.getInputValue('engine-lockSideMs'),
            cooldownMs: this.getInputValue('engine-cooldownMs')
        };

        // Collect TransitionEngine settings
        const transitionEngineConfig = {
            windowMs: this.getInputValue('transition-windowMs'),
            dominanceMetric: this.getInputValue('transition-dominanceMetric'),
            thrustThreshold: this.getInputValue('transition-thrustThreshold'),
            thrustChange: this.getInputValue('transition-thrustChange'),
            thrustMinVelocity: this.getInputValue('transition-thrustMinVelocity'),
            pullbackThreshold: this.getInputValue('transition-pullbackThreshold'),
            pullbackFade: this.getInputValue('transition-pullbackFade'),
            absorptionThreshold: this.getInputValue('transition-absorptionThreshold'),
            minEventInterval: this.getInputValue('transition-minEventInterval'),
            historyDepth: this.getInputValue('transition-historyDepth')
        };

        // Update engines
        if (this.eventEngine && this.eventEngine.updateConfig) {
            this.eventEngine.updateConfig(eventEngineConfig);
            this.eventEngine.reset();
        }

        if (this.transitionEngine && this.transitionEngine.updateConfig) {
            this.transitionEngine.updateConfig(transitionEngineConfig);
            this.transitionEngine.reset();
        }

        // Save to localStorage
        this.saveSettings({
            audioAlertMode: this.audioAlertMode,
            eventEngineConfig: eventEngineConfig,
            transitionEngineConfig: transitionEngineConfig
        });

        console.log('Settings applied:', {
            audioAlertMode: this.audioAlertMode,
            eventEngineConfig,
            transitionEngineConfig
        });
    }

    resetSettingsToDefaults() {
        const eventDefaults = this.getDefaultEventEngineConfig();
        const transitionDefaults = this.getDefaultTransitionEngineConfig();
        this.audioAlertMode = 'intelligent';

        if (this.eventEngine && this.eventEngine.updateConfig) {
            this.eventEngine.updateConfig(eventDefaults);
            this.eventEngine.reset();
        }

        if (this.transitionEngine && this.transitionEngine.updateConfig) {
            this.transitionEngine.updateConfig(transitionDefaults);
            this.transitionEngine.reset();
        }

        this.saveSettings({
            audioAlertMode: this.audioAlertMode,
            eventEngineConfig: eventDefaults,
            transitionEngineConfig: transitionDefaults
        });

        // Update UI dropdown
        const audioModeSelect = document.getElementById('audio-alert-mode');
        if (audioModeSelect) {
            audioModeSelect.value = this.audioAlertMode;
        }

        this.updateSettingsSectionsVisibility();
    }

    // -----------------------------
    // WebSocket
    // -----------------------------
    connectWebSocket() {
        const WS_URL = 'ws://10.211.55.5:8080';
        const statusEl = document.getElementById('connection-status');
        const reconnectBtn = document.getElementById('reconnect-btn');

        if (statusEl) {
            statusEl.textContent = 'Connecting...';
            statusEl.className = 'status connecting';
        }
        if (reconnectBtn) reconnectBtn.disabled = true;

        try {
            this.websocket = new WebSocket(WS_URL);

            this.websocket.onopen = () => {
                console.log('Connected to socket reader WebSocket');
                this.audioEngine.init();

                this.connectionStatus = 'connected';
                if (statusEl) {
                    statusEl.textContent = 'Connected';
                    statusEl.className = 'status connected';
                }
                if (reconnectBtn) reconnectBtn.disabled = true;

                this.resetStats();
            };

            this.websocket.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    if (message.type === 'trade') {
                        this.handleTrade(message.data);
                    }
                } catch (err) {
                    console.error('Failed to parse WebSocket message:', err);
                }
            };

            this.websocket.onerror = (error) => {
                console.error('WebSocket error:', error);
            };

            this.websocket.onclose = () => {
                console.log('Disconnected from socket reader');

                this.connectionStatus = 'disconnected';
                if (statusEl) {
                    statusEl.textContent = 'Disconnected';
                    statusEl.className = 'status disconnected';
                }
                if (reconnectBtn) reconnectBtn.disabled = false;

                setTimeout(() => {
                    if (this.connectionStatus === 'disconnected' && this.dataMode === 'websocket') {
                        console.log('Attempting to reconnect...');
                        this.connectWebSocket();
                    }
                }, 5000);
            };

        } catch (err) {
            console.error('Failed to create WebSocket:', err);
            if (statusEl) {
                statusEl.textContent = 'Error';
                statusEl.className = 'status disconnected';
            }
            if (reconnectBtn) reconnectBtn.disabled = false;
        }
    }

    // -----------------------------
    // Trade processing
    // -----------------------------
    processTrade(trade) {
        const side = trade.side;
        let volume = Number(trade.volume);

        if (side !== 'BID' && side !== 'ASK') return;
        if (!Number.isFinite(volume)) return;

        // Order aggregation: combine same-timestamp trades
        if (this.aggregateOrders) {
            const timestamp = trade.timestamp || Date.now();
            const key = `${timestamp}_${side}`;
            
            // Add to buffer
            if (this.aggregationBuffer.has(key)) {
                this.aggregationBuffer.set(key, this.aggregationBuffer.get(key) + volume);
            } else {
                this.aggregationBuffer.set(key, volume);
            }
            
            // Clear aggregation buffer after a brief delay (next event loop)
            if (this.aggregationTimeout) {
                clearTimeout(this.aggregationTimeout);
            }
            
            this.aggregationTimeout = setTimeout(() => {
                // Process all buffered trades
                for (const [bufferKey, aggVolume] of this.aggregationBuffer.entries()) {
                    const [, aggSide] = bufferKey.split('_');
                    this.processAggregatedTrade(aggSide, aggVolume);
                }
                this.aggregationBuffer.clear();
            }, 0);
            
            return; // Don't process individual trade
        }

        // Non-aggregated: process immediately
        this.processAggregatedTrade(side, volume);
    }

    processAggregatedTrade(side, volume) {
        // Update VU meter and stats with (possibly aggregated) volume
        this.vuMeter.updateVolume(side, volume);
        this.updateStats(side, volume);

        // RAW mode: play every trade
        if (this.audioAlertMode === 'raw') {
            this.audioEngine.playTrade(side, volume);
            return;
        }

        // For intelligent/transition modes, we need to pass through the engine
        // Reconstruct a trade object for the engine
        const engineTrade = {
            side: side,
            volume: volume,
            timestamp: Date.now()
        };

        // INTELLIGENT mode: use EventEngine
        if (this.audioAlertMode === 'intelligent' && this.eventEngine) {
            const event = this.eventEngine.ingest(engineTrade);
            if (!event) return;

            const pseudoVolume = Math.max(1, Math.round(event.strength * 10));
            this.audioEngine.playTrade(event.side, pseudoVolume);
            return;
        }

        // TRANSITION mode: use TransitionDetectionEngine
        if (this.audioAlertMode === 'transition' && this.transitionEngine) {
            const event = this.transitionEngine.ingest(engineTrade);
            if (!event) return;

            // Map transition events to audio
            this.playTransitionEvent(event);
            return;
        }
    }

    playTransitionEvent(event) {
        // Map transition events to distinct audio signatures
        const strength = Math.abs(event.imbalance);
        const pseudoVolume = Math.max(1, Math.round(strength * 10));

        switch (event.transitionType) {
            case 'THRUST_UP':
                // Strong buying - play on right (ASK)
                this.audioEngine.playTrade('ASK', pseudoVolume);
                break;

            case 'THRUST_DOWN':
                // Strong selling - play on left (BID)
                this.audioEngine.playTrade('BID', pseudoVolume);
                break;

            case 'PULLBACK_EXHAUSTION':
                // Pullback ending - play based on trend direction
                const side = event.trendDirection === 'UP' ? 'ASK' : 'BID';
                this.audioEngine.playTrade(side, Math.max(1, pseudoVolume / 2));
                break;

            case 'ABSORPTION':
                // Absorption - play balanced/center (alternate or quieter)
                this.audioEngine.playTrade('BID', Math.max(1, pseudoVolume / 3));
                break;
        }
    }

    handleTrade(trade) {
        if (this.dataMode !== 'websocket') return;
        this.processTrade(trade);
    }

    handlePlay() {
        if (!this.dataPlayer.data || this.dataPlayer.data.length === 0) {
            alert('Please load a CSV file first');
            return;
        }

        this.resetStats();

        this.dataPlayer.play((trade) => {
            this.processTrade(trade);
        });
    }

    handlePause() {
        this.dataPlayer.pause();
    }

    handleStop() {
        this.dataPlayer.stop();
        this.resetStats();
    }

    handleFileUpload(file) {
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const csvData = e.target.result;
            this.dataPlayer.loadCSV(csvData);
            console.log('CSV file loaded:', this.dataPlayer.data.length, 'trades');
        };
        reader.readAsText(file);
    }

    // -----------------------------
    // Stats
    // -----------------------------
    updateStats(side, volume) {
        if (!this.stats.startTime) {
            this.stats.startTime = Date.now();
        }

        if (side === 'BID') {
            this.stats.sellCount++;
            this.stats.sellVolume += volume;
        } else {
            this.stats.buyCount++;
            this.stats.buyVolume += volume;
        }
    }

    resetStats() {
        this.stats = {
            sellCount: 0,
            buyCount: 0,
            sellVolume: 0,
            buyVolume: 0,
            startTime: Date.now()
        };

        if (this.eventEngine) {
            this.eventEngine.reset();
        }

        if (this.transitionEngine) {
            this.transitionEngine.reset();
        }
    }

    startStatsUpdate() {
        setInterval(() => {
            this.updateStatsDisplay();
        }, 100);
    }

    updateStatsDisplay() {
        const setText = (id, value) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.textContent = value;
        };

        setText('sell-count', this.stats.sellCount);
        setText('buy-count', this.stats.buyCount);
        setText('sell-volume', this.stats.sellVolume);
        setText('buy-volume', this.stats.buyVolume);

        if (!this.stats.startTime) return;

        const elapsed = (Date.now() - this.stats.startTime) / 1000;
        if (elapsed <= 0) {
            setText('sell-trades-per-sec', '0.0');
            setText('buy-trades-per-sec', '0.0');
            setText('sell-vol-per-sec', '0.0');
            setText('buy-vol-per-sec', '0.0');
            setText('events-per-sec', '0.0');
            return;
        }

        const sellTradesPerSec = this.stats.sellCount / elapsed;
        const buyTradesPerSec = this.stats.buyCount / elapsed;
        const sellVolPerSec = this.stats.sellVolume / elapsed;
        const buyVolPerSec = this.stats.buyVolume / elapsed;

        setText('sell-trades-per-sec', sellTradesPerSec.toFixed(1));
        setText('buy-trades-per-sec', buyTradesPerSec.toFixed(1));
        setText('sell-vol-per-sec', sellVolPerSec.toFixed(1));
        setText('buy-vol-per-sec', buyVolPerSec.toFixed(1));

        const totalEvents = this.stats.sellCount + this.stats.buyCount;
        const eventsPerSec = totalEvents / elapsed;
        setText('events-per-sec', eventsPerSec.toFixed(1));
    }
}

// Initialize app when DOM is ready
let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new TradeFlowApp();
});