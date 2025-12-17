// app.js
// Main application logic

class TradeFlowApp {
    constructor() {
        this.audioEngine = new AudioEngine();
        this.vuMeter = new VUMeter('vu-meter-canvas');
        this.dataPlayer = new DataPlayer();

        // WebSocket state
        this.websocket = null;
        this.connectionStatus = 'disconnected';
        this.dataMode = 'websocket';  // 'websocket' or 'playback'

        // Audio alert mode
        // 'raw' plays every tick
        // 'intelligent' only plays when EventEngine emits a flow event
        this.audioAlertMode = 'intelligent';

        // Event Engine
        this.eventEngine = null;
        this.initializeEventEngine();

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
    getDefaultEngineConfig() {
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
    // Event engine init
    // -----------------------------
    initializeEventEngine() {
        if (typeof EventEngine === 'undefined') {
            console.warn('EventEngine not found. Ensure event-engine.js is loaded before app.js.');
            return;
        }

        const saved = this.loadSettings();
        const defaults = this.getDefaultEngineConfig();

        const engineConfig = {
            ...defaults,
            ...(saved?.engineConfig || {}),
            minTotalVolumeInWindow: 0,
            debug: false
        };

        this.eventEngine = new EventEngine(engineConfig);

        if (saved?.audioAlertMode) {
            this.audioAlertMode = saved.audioAlertMode;
        }
    }

    // -----------------------------
    // UI init
    // -----------------------------
    initializeUI() {
        // Enable audio on first click (autoplay policy)
        document.addEventListener('click', () => {
            if (!this.audioEngine.isInitialized) {
                this.audioEngine.init();
                console.log('Audio enabled');
            }
        }, { once: true });

        // Master volume control
        const volumeSlider = document.getElementById('master-volume');
        const volumeValue = document.getElementById('volume-value');

        if (volumeSlider && volumeValue) {
            volumeSlider.addEventListener('input', (e) => {
                const pct = parseInt(e.target.value, 10);    // 0..200
                const x = pct / 100;                         // 0..2
                const curved = Math.pow(x, 1.6);             // perceptual curve
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

        // Settings drawer wiring
        this.initializeSettingsDrawer();
        this.populateSettingsUIFromCurrent();
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

    // -----------------------------
    // Settings drawer methods
    // -----------------------------
    initializeSettingsDrawer() {
        const openBtn = document.getElementById('open-settings-btn');
        const closeBtn = document.getElementById('close-settings-btn');
        const overlay = document.getElementById('settings-overlay');
        const drawer = document.getElementById('settings-drawer');

        const applyBtn = document.getElementById('apply-settings-btn');
        const resetBtn = document.getElementById('reset-settings-btn');

        if (!overlay || !drawer) return;

        const open = () => {
            overlay.style.display = 'block';
            drawer.classList.add('open');
            drawer.setAttribute('aria-hidden', 'false');
            this.populateSettingsUIFromCurrent();
        };

        const close = () => {
            overlay.style.display = 'none';
            drawer.classList.remove('open');
            drawer.setAttribute('aria-hidden', 'true');
        };

        if (openBtn) openBtn.addEventListener('click', open);
        if (closeBtn) closeBtn.addEventListener('click', close);
        overlay.addEventListener('click', close);

        if (applyBtn) {
            applyBtn.addEventListener('click', () => {
                this.applySettingsFromUI();
                close();
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
        const modeSelect = document.getElementById('audio-alert-mode');
        if (modeSelect) modeSelect.value = this.audioAlertMode || 'raw';

        const cfg = (this.eventEngine && this.eventEngine.getState)
            ? this.eventEngine.getState().config
            : this.getDefaultEngineConfig();

        const setVal = (id, value) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.value = value;
        };

        setVal('engine-windowMs', cfg.windowMs);
        setVal('engine-dominanceMetric', cfg.dominanceMetric);
        setVal('engine-enterDominance', cfg.enterDominance);
        setVal('engine-exitDominance', cfg.exitDominance);
        setVal('engine-minTradesPerSec', cfg.minTradesPerSec);
        setVal('engine-maxEventsPerSec', cfg.maxEventsPerSec);
        setVal('engine-requireSustainedMs', cfg.requireSustainedMs);
        setVal('engine-lockSideMs', cfg.lockSideMs);
        setVal('engine-cooldownMs', cfg.cooldownMs);
    }

    applySettingsFromUI() {
        const modeSelect = document.getElementById('audio-alert-mode');
        const newMode = modeSelect ? modeSelect.value : 'raw';
        this.audioAlertMode = newMode;

        const readNum = (id) => {
            const el = document.getElementById(id);
            if (!el) return null;
            const v = Number(el.value);
            return Number.isFinite(v) ? v : null;
        };

        const readStr = (id) => {
            const el = document.getElementById(id);
            return el ? String(el.value) : null;
        };

        const engineConfig = {
            windowMs: readNum('engine-windowMs'),
            dominanceMetric: readStr('engine-dominanceMetric'),
            enterDominance: readNum('engine-enterDominance'),
            exitDominance: readNum('engine-exitDominance'),
            minTradesPerSec: readNum('engine-minTradesPerSec'),
            maxEventsPerSec: readNum('engine-maxEventsPerSec'),
            requireSustainedMs: readNum('engine-requireSustainedMs'),
            lockSideMs: readNum('engine-lockSideMs'),
            cooldownMs: readNum('engine-cooldownMs')
        };

        Object.keys(engineConfig).forEach(k => {
            if (engineConfig[k] === null || engineConfig[k] === '') delete engineConfig[k];
        });

        if (this.eventEngine && this.eventEngine.updateConfig) {
            this.eventEngine.updateConfig(engineConfig);
            this.eventEngine.reset();
        }

        this.saveSettings({
            audioAlertMode: this.audioAlertMode,
            engineConfig: (this.eventEngine && this.eventEngine.getState)
                ? this.eventEngine.getState().config
                : engineConfig
        });

        console.log('Settings applied:', { audioAlertMode: this.audioAlertMode, engineConfig });
    }

    resetSettingsToDefaults() {
        const defaults = this.getDefaultEngineConfig();
        this.audioAlertMode = 'raw';

        if (this.eventEngine && this.eventEngine.updateConfig) {
            this.eventEngine.updateConfig(defaults);
            this.eventEngine.reset();
        }

        this.saveSettings({
            audioAlertMode: this.audioAlertMode,
            engineConfig: defaults
        });
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

                // Note: user gesture listener above is the real guarantee.
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
        const volume = Number(trade.volume);

        if (side !== 'BID' && side !== 'ASK') return;
        if (!Number.isFinite(volume)) return;

        this.vuMeter.updateVolume(side, volume);
        this.updateStats(side, volume);

        if (this.audioAlertMode === 'raw' || !this.eventEngine) {
            this.audioEngine.playTrade(side, volume);
            return;
        }

        const event = this.eventEngine.ingest(trade);
        if (!event) return;

        const pseudoVolume = Math.max(1, Math.round(event.strength * 10));
        this.audioEngine.playTrade(event.side, pseudoVolume);
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

        // Per-side rates
        const sellTradesPerSec = this.stats.sellCount / elapsed;
        const buyTradesPerSec = this.stats.buyCount / elapsed;
        const sellVolPerSec = this.stats.sellVolume / elapsed;
        const buyVolPerSec = this.stats.buyVolume / elapsed;

        setText('sell-trades-per-sec', sellTradesPerSec.toFixed(1));
        setText('buy-trades-per-sec', buyTradesPerSec.toFixed(1));
        setText('sell-vol-per-sec', sellVolPerSec.toFixed(1));
        setText('buy-vol-per-sec', buyVolPerSec.toFixed(1));

        // Total events/sec (kept for compatibility; you said you may hide this)
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
