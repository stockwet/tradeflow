// app.js
// Main application logic

class TradeFlowApp {
    constructor() {
        this.audioEngine = new AudioEngine();
        this.vuMeter = new VUMeter('vu-meter-canvas');
        this.dataPlayer = new DataPlayer();

        this.imbalanceMeter = new ImbalanceMeter('imbalance-meter', {
            maxAbs: 30,
            smoothing: 0.15,
            segments: 10
        });

        // Velocity pulse mode engine (vol/sec baseline -> machine gun)
        this.velocityPulseEngine = new VelocityPulseEngine(this.audioEngine, {
            baselineWindowMs: 45000,
            sensitivityK: 1.0,
            minAbsTradesPerSec: 4.0,
            minAbsVolPerSec: 6.0,
            switchMarginZ: 0.6,
            minSwitchMs: 60,
            minRate: 3,
            maxRate: 28
        });
        this.velocityPulseEngine.start();



        // WebSocket state
        this.websocket = null;
        this.connectionStatus = 'disconnected';
        this.dataMode = 'websocket';  // 'websocket' or 'playback'
        this.userDisconnected = false;


        // Audio alert mode: 'raw' | 'intelligent' | 'transition'
        this.audioAlertMode = 'intelligent';

        // Engines
        this.eventEngine = null;              // intelligent mode engine (EventEngine)
        this.transitionEngine = null;         // transition detection engine (TransitionDetectionEngine)

        this.initializeEngines();

        // Rolling rate settings
        this.rateWindowMs = 5000;
        this.recentTrades = [];

        // Totals
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

    // These IDs exist in your index.html transition section.
    // We keep defaults conservative so it won't spam.
    getDefaultTransitionConfig() {
        return {
            windowMs: 300,
            thrustThreshold: 0.60,
            flipThreshold: 0.60,
            minTradesPerSec: 25,
            minTotalVolume: 0,
            requireSustainedMs: 60,
            lockSideMs: 150,
            cooldownMs: 0
        };
    }


    getDefaultAudioConfig() {
        return {
            masterVolume: 0.70,     // 0.0 - 2.0 (UI shows 0-200%)
            bidFrequency: 100,
            askFrequency: 1000,
            meterSensitivity: 1.0,  // 0.0 - 1.0
            aggregateOrders: false
        };
    }

    // Velocity Pulse defaults (matches constructor config)
    getDefaultVelocityPulseConfig() {
        return {
            baselineWindowMs: 45000,
            sensitivityK: 1.0,
            minAbsTradesPerSec: 4.0,
            minAbsVolPerSec: 6.0,
            switchMarginZ: 0.6,
            minSwitchMs: 60,
            minRate: 3,
            maxRate: 28,
            rateCurve: 1.7,
            clickDurationSec: 0.045,
            fullScaleZPace: 3.0,
            fullScaleZVol: 3.0
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
    // Engine init
    // -----------------------------
    initializeEngines() {
        const saved = this.loadSettings();
        this._savedSettings = saved || {};

        // Load mode first
        if (saved?.audioAlertMode) {
            this.audioAlertMode = saved.audioAlertMode;
        }

        // Intelligent engine
        if (typeof EventEngine !== 'undefined') {
            const defaults = this.getDefaultEngineConfig();
            const engineConfig = {
                ...defaults,
                ...(saved?.engineConfig || {}),
                minTotalVolumeInWindow: 0,
                debug: false
            };
            this.eventEngine = new EventEngine(engineConfig);
        } else {
            console.warn('EventEngine not found. Ensure event-engine.js is loaded before app.js.');
        }

        // Transition engine
        if (typeof TransitionDetectionEngine !== 'undefined') {
            const tDefaults = this.getDefaultTransitionConfig();
            const transitionConfig = {
                ...tDefaults,
                ...(saved?.transitionConfig || {})
            };

            this.transitionEngine = new TransitionDetectionEngine(transitionConfig);
        } else {
            // Only warn if you actually try to use it
            // console.warn('TransitionDetectionEngine not found. Ensure transition-detection-engine.js is loaded.');
        }

        // Velocity pulse engine config
        if (this.velocityPulseEngine && this.velocityPulseEngine.updateConfig) {
            const vDefaults = this.getDefaultVelocityPulseConfig();
            const vCfg = { ...vDefaults, ...(saved?.velocityPulseConfig || {}) };
            this.velocityPulseEngine.updateConfig(vCfg);
        }

    }


    // -----------------------------
    // Settings helpers
    // -----------------------------
    _getCurrentPersistableSettings() {
        const saved = this.loadSettings() || {};
        return {
            audioAlertMode: this.audioAlertMode,
            audioConfig: saved.audioConfig || this.getDefaultAudioConfig(),
            engineConfig: saved.engineConfig || this.getDefaultEngineConfig(),
            transitionConfig: saved.transitionConfig || this.getDefaultTransitionConfig(),
            velocityPulseConfig: saved.velocityPulseConfig || this.getDefaultVelocityPulseConfig()
        };
    }

    _saveSettingsPatch(patch = {}) {
        const current = this._getCurrentPersistableSettings();
        const merged = { ...current, ...patch };
        this.saveSettings(merged);
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

        // Audio controls (now in settings drawer per your changes)
        const volumeSlider = document.getElementById('master-volume');
        const volumeValue = document.getElementById('volume-value');
        if (volumeSlider && volumeValue) {
            volumeSlider.addEventListener('input', (e) => {
                const volume = parseInt(e.target.value, 10) / 100;
                this.audioEngine.setVolume(volume);
                volumeValue.textContent = e.target.value + '%';
                this._saveSettingsPatch({ audioConfig: { ...(this.loadSettings()?.audioConfig || this.getDefaultAudioConfig()), masterVolume: volume } });
            });
        }

        const bidFreqSlider = document.getElementById('bid-frequency');
        const bidFreqValue = document.getElementById('bid-freq-value');
        if (bidFreqSlider && bidFreqValue) {
            bidFreqSlider.addEventListener('input', (e) => {
                const freq = parseInt(e.target.value, 10);
                this.audioEngine.setBidFrequency(freq);
                bidFreqValue.textContent = freq + ' Hz';
                this._saveSettingsPatch({ audioConfig: { ...(this.loadSettings()?.audioConfig || this.getDefaultAudioConfig()), bidFrequency: freq } });
            });
        }

        const askFreqSlider = document.getElementById('ask-frequency');
        const askFreqValue = document.getElementById('ask-freq-value');
        if (askFreqSlider && askFreqValue) {
            askFreqSlider.addEventListener('input', (e) => {
                const freq = parseInt(e.target.value, 10);
                this.audioEngine.setAskFrequency(freq);
                askFreqValue.textContent = freq + ' Hz';
                this._saveSettingsPatch({ audioConfig: { ...(this.loadSettings()?.audioConfig || this.getDefaultAudioConfig()), askFrequency: freq } });
            });
        }

        const sensitivitySlider = document.getElementById('sensitivity');
        const sensitivityValue = document.getElementById('sensitivity-value');
        if (sensitivitySlider && sensitivityValue) {
            sensitivitySlider.addEventListener('input', (e) => {
                const sensitivity = parseInt(e.target.value, 10) / 100;
                this.vuMeter.setSensitivity(sensitivity);
                sensitivityValue.textContent = e.target.value + '%';
                this._saveSettingsPatch({ audioConfig: { ...(this.loadSettings()?.audioConfig || this.getDefaultAudioConfig()), meterSensitivity: sensitivity } });
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
        // Connect / Disconnect button (single control)
        const reconnectBtn = document.getElementById('reconnect-btn');
        if (reconnectBtn) {
            reconnectBtn.addEventListener('click', () => {
                if (this.connectionStatus === 'connected') {
                    // Manual disconnect: prevent auto-reconnect
                    this.userDisconnected = true;
                    this.websocket?.close();
                } else if (this.connectionStatus === 'disconnected') {
                    // Manual connect: allow auto-reconnect again
                    this.userDisconnected = false;
                    this.connectWebSocket();
                }
            });
        }



        this.updateUIForMode();

        // Settings drawer wiring
        this.initializeSettingsDrawer();

        // Apply persisted audio settings immediately
        const saved = this.loadSettings() || {};
        const aCfg = { ...this.getDefaultAudioConfig(), ...(saved.audioConfig || {}) };
        this.audioEngine.setVolume(aCfg.masterVolume);
        this.audioEngine.setBidFrequency(aCfg.bidFrequency);
        this.audioEngine.setAskFrequency(aCfg.askFrequency);
        this.vuMeter.setSensitivity(aCfg.meterSensitivity);

        // Populate + show correct section
        this.populateSettingsUIFromCurrent();
        this.updateSettingsVisibility();
        this.bindModeSelectorVisibility();
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

        const resetBtn = document.getElementById('reset-settings-btn');

        if (!overlay || !drawer) return;

        const open = () => {
            overlay.style.display = 'block';
            drawer.classList.add('open');
            drawer.setAttribute('aria-hidden', 'false');
            this.populateSettingsUIFromCurrent();
            this.updateSettingsVisibility();
        };

        const close = () => {
            overlay.style.display = 'none';
            drawer.classList.remove('open');
            drawer.setAttribute('aria-hidden', 'true');
        };

        if (openBtn) openBtn.addEventListener('click', open);
        if (closeBtn) closeBtn.addEventListener('click', close);
        overlay.addEventListener('click', close);

        // Auto-apply: any change in the drawer updates settings immediately.
        const drawerBody = drawer.querySelector('.drawer-body');
        if (drawerBody) {
            const handler = (e) => {
                const target = e.target;
                if (!target || !target.id) return;

                // Audio widgets are handled by their own listeners in initializeUI.
                // Here we handle engine + mode-specific widgets.
                const isEngineOrModeSetting =
                    target.id.startsWith('engine-') ||
                    target.id.startsWith('transition-') ||
                    target.id.startsWith('velocity-') ||
                    target.id === 'aggregate-orders';

                if (!isEngineOrModeSetting) return;

                this.applySettingsFromUI(); // reads UI + persists
            };

            drawerBody.addEventListener('input', handler);
            drawerBody.addEventListener('change', handler);
        }

        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                this.resetSettingsToDefaults();
                this.populateSettingsUIFromCurrent();
                this.updateSettingsVisibility();
            });
        }
    }

    bindModeSelectorVisibility() {
        const modeSelect = document.getElementById('audio-alert-mode');
        if (!modeSelect) return;

        modeSelect.addEventListener('change', () => {
            this.audioAlertMode = modeSelect.value;
            this.updateSettingsVisibility();
            this._saveSettingsPatch({ audioAlertMode: this.audioAlertMode });
        });
    }

    updateSettingsVisibility() {
        const intelligentSection = document.getElementById('intelligent-settings');
        const transitionSection = document.getElementById('transition-settings');
        const velocitySection = document.getElementById('velocity-settings');

        if (intelligentSection) intelligentSection.style.display = 'none';
        if (transitionSection) transitionSection.style.display = 'none';
        if (velocitySection) velocitySection.style.display = 'none';

        if (this.audioAlertMode === 'intelligent') {
            if (intelligentSection) intelligentSection.style.display = 'block';
        } else if (this.audioAlertMode === 'transition') {
            if (transitionSection) transitionSection.style.display = 'block';
        } else if (this.audioAlertMode === 'velocity') {
            if (velocitySection) velocitySection.style.display = 'block';
        }
    }

    populateSettingsUIFromCurrent() {
        const modeSelect = document.getElementById('audio-alert-mode');
        if (modeSelect) modeSelect.value = this.audioAlertMode || 'raw';

        // Audio config (persisted)
        const saved = this.loadSettings() || {};
        const aCfg = { ...this.getDefaultAudioConfig(), ...(saved.audioConfig || {}) };

        const agg = document.getElementById('aggregate-orders');
        if (agg) agg.checked = !!aCfg.aggregateOrders;

        const volumeSlider = document.getElementById('master-volume');
        const volumeValue = document.getElementById('volume-value');
        if (volumeSlider && volumeValue) {
            const volPct = Math.round((aCfg.masterVolume ?? 0.7) * 100);
            volumeSlider.value = String(volPct);
            volumeValue.textContent = volPct + '%';
        }

        const bidFreqSlider = document.getElementById('bid-frequency');
        const bidFreqValue = document.getElementById('bid-freq-value');
        if (bidFreqSlider && bidFreqValue) {
            bidFreqSlider.value = String(aCfg.bidFrequency ?? 100);
            bidFreqValue.textContent = (aCfg.bidFrequency ?? 100) + ' Hz';
        }

        const askFreqSlider = document.getElementById('ask-frequency');
        const askFreqValue = document.getElementById('ask-freq-value');
        if (askFreqSlider && askFreqValue) {
            askFreqSlider.value = String(aCfg.askFrequency ?? 1000);
            askFreqValue.textContent = (aCfg.askFrequency ?? 1000) + ' Hz';
        }

        const sensitivitySlider = document.getElementById('sensitivity');
        const sensitivityValue = document.getElementById('sensitivity-value');
        if (sensitivitySlider && sensitivityValue) {
            const sensPct = Math.round((aCfg.meterSensitivity ?? 1.0) * 100);
            sensitivitySlider.value = String(sensPct);
            sensitivityValue.textContent = sensPct + '%';
        }


        const setVal = (id, value) => {
            const el = document.getElementById(id);
            if (el && value !== undefined && value !== null) el.value = value;
        };

        // Intelligent settings
        const cfg = (this.eventEngine && this.eventEngine.getState)
            ? this.eventEngine.getState().config
            : this.getDefaultEngineConfig();

        setVal('engine-windowMs', cfg.windowMs);
        setVal('engine-dominanceMetric', cfg.dominanceMetric);
        setVal('engine-enterDominance', cfg.enterDominance);
        setVal('engine-exitDominance', cfg.exitDominance);
        setVal('engine-minTradesPerSec', cfg.minTradesPerSec);
        setVal('engine-maxEventsPerSec', cfg.maxEventsPerSec);
        setVal('engine-requireSustainedMs', cfg.requireSustainedMs);
        setVal('engine-lockSideMs', cfg.lockSideMs);
        setVal('engine-cooldownMs', cfg.cooldownMs);

        // Transition settings
        const tcfg = (this.transitionEngine && this.transitionEngine.getState)
            ? this.transitionEngine.getState().config
            : this.getDefaultTransitionConfig();

        setVal('transition-windowMs', tcfg.windowMs);
        setVal('transition-thrustThreshold', tcfg.thrustThreshold);
        setVal('transition-flipThreshold', tcfg.flipThreshold);
        setVal('transition-minTradesPerSec', tcfg.minTradesPerSec);
        setVal('transition-minTotalVolume', tcfg.minTotalVolume);
        setVal('transition-requireSustainedMs', tcfg.requireSustainedMs);
        setVal('transition-lockSideMs', tcfg.lockSideMs);
        setVal('transition-cooldownMs', tcfg.cooldownMs);


        // Velocity Pulse settings
        const vCfg = { ...this.getDefaultVelocityPulseConfig(), ...(saved.velocityPulseConfig || {}) };
        const setV = (id, value) => {
            const el = document.getElementById(id);
            if (el && value !== undefined && value !== null) el.value = value;
        };

        setV('velocity-baselineWindowMs', vCfg.baselineWindowMs);
        setV('velocity-sensitivityK', vCfg.sensitivityK);
        setV('velocity-minAbsTradesPerSec', vCfg.minAbsTradesPerSec);
        setV('velocity-minAbsVolPerSec', vCfg.minAbsVolPerSec);
        setV('velocity-switchMarginZ', vCfg.switchMarginZ);
        setV('velocity-minSwitchMs', vCfg.minSwitchMs);
        setV('velocity-minRate', vCfg.minRate);
        setV('velocity-maxRate', vCfg.maxRate);
        setV('velocity-rateCurve', vCfg.rateCurve);
        setV('velocity-fullScaleZPace', vCfg.fullScaleZPace);
        setV('velocity-fullScaleZVol', vCfg.fullScaleZVol);

    }

    applySettingsFromUI() {
        const modeSelect = document.getElementById('audio-alert-mode');
        this.audioAlertMode = modeSelect ? modeSelect.value : (this.audioAlertMode || 'raw');

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

        // Persisted audio config (aggregate only here; sliders already persist in their listeners)
        const saved = this.loadSettings() || {};
        const aCfg = { ...this.getDefaultAudioConfig(), ...(saved.audioConfig || {}) };
        const agg = document.getElementById('aggregate-orders');
        if (agg) {
            aCfg.aggregateOrders = !!agg.checked;
            // (If/when AudioEngine supports it, apply here too)
        }

        // Intelligent config
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

        // Transition config
        const transitionConfig = {
            windowMs: readNum('transition-windowMs'),
            thrustThreshold: readNum('transition-thrustThreshold'),
            flipThreshold: readNum('transition-flipThreshold'),
            minTradesPerSec: readNum('transition-minTradesPerSec'),
            minTotalVolume: readNum('transition-minTotalVolume'),
            requireSustainedMs: readNum('transition-requireSustainedMs'),
            lockSideMs: readNum('transition-lockSideMs'),
            cooldownMs: readNum('transition-cooldownMs')
        };
        Object.keys(transitionConfig).forEach(k => {
            if (transitionConfig[k] === null || transitionConfig[k] === '') delete transitionConfig[k];
        });

        if (this.transitionEngine && this.transitionEngine.updateConfig) {
            this.transitionEngine.updateConfig(transitionConfig);
            this.transitionEngine.reset?.();
        }

        // Velocity Pulse config
        const velocityPulseConfig = {
            baselineWindowMs: readNum('velocity-baselineWindowMs'),
            sensitivityK: readNum('velocity-sensitivityK'),
            minAbsTradesPerSec: readNum('velocity-minAbsTradesPerSec'),
            minAbsVolPerSec: readNum('velocity-minAbsVolPerSec'),
            switchMarginZ: readNum('velocity-switchMarginZ'),
            minSwitchMs: readNum('velocity-minSwitchMs'),
            minRate: readNum('velocity-minRate'),
            maxRate: readNum('velocity-maxRate'),
            rateCurve: readNum('velocity-rateCurve'),
            fullScaleZPace: readNum('velocity-fullScaleZPace'),
            fullScaleZVol: readNum('velocity-fullScaleZVol')
        };
        Object.keys(velocityPulseConfig).forEach(k => {
            if (velocityPulseConfig[k] === null || velocityPulseConfig[k] === '') delete velocityPulseConfig[k];
        });

        if (this.velocityPulseEngine && this.velocityPulseEngine.updateConfig) {
            this.velocityPulseEngine.updateConfig(velocityPulseConfig);
        }

        this._saveSettingsPatch({
            audioAlertMode: this.audioAlertMode,
            audioConfig: aCfg,
            engineConfig: (this.eventEngine && this.eventEngine.getState)
                ? this.eventEngine.getState().config
                : engineConfig,
            transitionConfig: (this.transitionEngine && this.transitionEngine.getState)
                ? this.transitionEngine.getState().config
                : transitionConfig,
            velocityPulseConfig: { ...this.getDefaultVelocityPulseConfig(), ...(saved.velocityPulseConfig || {}), ...velocityPulseConfig }
        });

        this.updateSettingsVisibility();
    }

    resetSettingsToDefaults() {
        const defaults = this.getDefaultEngineConfig();
        const tDefaults = this.getDefaultTransitionConfig();
        const vDefaults = this.getDefaultVelocityPulseConfig();
        const aDefaults = this.getDefaultAudioConfig();

        this.audioAlertMode = 'raw';

        if (this.eventEngine && this.eventEngine.updateConfig) {
            this.eventEngine.updateConfig(defaults);
            this.eventEngine.reset();
        }

        if (this.transitionEngine && this.transitionEngine.updateConfig) {
            this.transitionEngine.updateConfig(tDefaults);
            this.transitionEngine.reset?.();
        }

        if (this.velocityPulseEngine && this.velocityPulseEngine.updateConfig) {
            this.velocityPulseEngine.updateConfig(vDefaults);
            this.velocityPulseEngine.reset?.();
        }

        // Apply audio defaults immediately
        this.audioEngine.setVolume(aDefaults.masterVolume);
        this.audioEngine.setBidFrequency(aDefaults.bidFrequency);
        this.audioEngine.setAskFrequency(aDefaults.askFrequency);
        this.vuMeter.setSensitivity(aDefaults.meterSensitivity);

        this.saveSettings({
            audioAlertMode: this.audioAlertMode,
            audioConfig: aDefaults,
            engineConfig: defaults,
            transitionConfig: tDefaults,
            velocityPulseConfig: vDefaults
        });
    }

    // -----------------------------
    // WebSocket
    // -----------------------------
    connectWebSocket() {
        const WS_URL = 'ws://10.211.55.5:8080';
        // If user intentionally disconnected, don't reconnect automatically
        if (this.userDisconnected) {
            this.updateConnectButton('disconnected');
            return;
        }


        // Prevent duplicate connections
        if (this.websocket && 
            (this.websocket.readyState === WebSocket.OPEN || 
            this.websocket.readyState === WebSocket.CONNECTING)) {
            return;
        }

        this.connectionStatus = 'connecting';
        this.updateConnectButton('connecting');

        try {
            this.websocket = new WebSocket(WS_URL);

            this.websocket.onopen = () => {
                console.log('Connected to socket reader WebSocket');
                this.audioEngine.init();

                this.connectionStatus = 'connected';
                this.updateConnectButton('connected');

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
                // Let onclose handle UI + reconnect
            };

            this.websocket.onclose = () => {
                console.log('Disconnected from socket reader');

                this.websocket = null;
                this.connectionStatus = 'disconnected';
                this.updateConnectButton('disconnected');

                // Auto-reconnect only if still in websocket mode
                if (this.dataMode === 'websocket') {
                    setTimeout(() => {
                        if (
                            this.connectionStatus === 'disconnected' &&
                            this.dataMode === 'websocket' &&
                            !this.userDisconnected
                        ) {
                            console.log('Attempting to reconnect...');
                            this.connectWebSocket();
                        }
                    }, 5000);

                }
            };

        } catch (err) {
            console.error('Failed to create WebSocket:', err);
            this.websocket = null;
            this.connectionStatus = 'disconnected';
            this.updateConnectButton('disconnected');
        }
    }


    updateConnectButton(state) {
        const btn = document.getElementById('reconnect-btn');
        if (!btn) return;

        const dot = btn.querySelector('.conn-dot');
        const label = btn.querySelector('.conn-label');

        dot.classList.remove('connected', 'connecting', 'disconnected');

        if (state === 'connected') {
            dot.classList.add('connected');
            label.textContent = 'Disconnect';
            btn.disabled = false;
        } 
        else if (state === 'connecting') {
            dot.classList.add('connecting');
            label.textContent = 'Connecting...';
            btn.disabled = true;
        } 
        else {
            dot.classList.add('disconnected');
            label.textContent = 'Connect';
            btn.disabled = false;
        }
    }


    // -----------------------------
    // Audio + Visual alignment helper
    // -----------------------------
    _emitAudioAndVisual(side, pseudoVolume, durationSec = undefined) {
        // Keep the VU meter in the same units the audio engine is using for the current mode.
        // (RAW mode passes actual trade volume; other modes pass pseudo-volume.)
        this.audioEngine.playTrade(side, pseudoVolume, durationSec);
        this.vuMeter.updateVolume(side, pseudoVolume);
    }

    // -----------------------------
    // Trade processing
    // -----------------------------
    processTrade(trade) {
        const side = trade.side;
        const volume = Number(trade.volume);

        if (side !== 'BID' && side !== 'ASK') return;
        if (!Number.isFinite(volume)) return;

        // totals + rolling buffer (always track raw tape stats)
        this.updateStats(side, volume);

        // RAW mode: audio is per trade using real volume, so meter should match tape
        if (this.audioAlertMode === 'raw') {
            this._emitAudioAndVisual(side, volume);
            return;
        }

        // VELOCITY PULSE mode: audio is scheduled by velocity engine (not per trade).
        // The VU meter is updated from the same derived loudness in updateStatsDisplay().
        if (this.audioAlertMode === 'velocity') {
            return;
        }

        // TRANSITION mode: drive audio + meter from transition events (not raw tape)
        if (this.audioAlertMode === 'transition') {
            if (!this.transitionEngine) {
                // fallback
                this._emitAudioAndVisual(side, volume);
                return;
            }

            const evt = this.transitionEngine.ingest(trade);
            if (!evt) return;

            // TransitionDetectionEngine provides imbalance (-1..+1) and/or other metrics.
            // Prefer imbalance magnitude for loudness; fall back to evt.strength if present.
            const imbalance = Number.isFinite(evt.imbalance) ? evt.imbalance : null;
            const derivedSide = imbalance !== null ? (imbalance >= 0 ? 'ASK' : 'BID') : (evt.side ?? side);

            const strength01 =
                imbalance !== null
                    ? Math.min(1, Math.abs(imbalance))
                    : (Number.isFinite(evt.strength) ? Math.min(1, Math.abs(evt.strength)) : 1);

            const pseudoVolume = Math.max(1, Math.round(strength01 * 10));
            this._emitAudioAndVisual(derivedSide, pseudoVolume);
            return;
        }

        // INTELLIGENT mode: drive audio + meter from EventEngine events (not raw tape)
        if (!this.eventEngine) {
            this._emitAudioAndVisual(side, volume);
            return;
        }

        const event = this.eventEngine.ingest(trade);
        if (!event) return;

        const pseudoVolume = Math.max(1, Math.round(event.strength * 10));
        this._emitAudioAndVisual(event.side, pseudoVolume);
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

    handlePause() { this.dataPlayer.pause(); }
    handleStop()  { this.dataPlayer.stop(); this.resetStats(); }

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
    // Stats (Totals + Rolling Window)
    // -----------------------------
    updateStats(side, volume) {
        const now = Date.now();

        if (!this.stats.startTime) {
            this.stats.startTime = now;
        }

        // Totals
        if (side === 'BID') {
            this.stats.sellCount++;
            this.stats.sellVolume += volume;
        } else {
            this.stats.buyCount++;
            this.stats.buyVolume += volume;
        }

        // Rolling buffer
        this.recentTrades.push({ t: now, side, volume });
        this.pruneRecentTrades(now);
    }

    pruneRecentTrades(now = Date.now()) {
        const cutoff = now - this.rateWindowMs;
        while (this.recentTrades.length > 0 && this.recentTrades[0].t < cutoff) {
            this.recentTrades.shift();
        }
    }

    computeRollingRates() {
        const now = Date.now();
        this.pruneRecentTrades(now);

        const windowSec = this.rateWindowMs / 1000;

        let sellTrades = 0, buyTrades = 0;
        let sellVol = 0, buyVol = 0;

        for (const tr of this.recentTrades) {
            if (tr.side === 'BID') {
                sellTrades++;
                sellVol += tr.volume;
            } else if (tr.side === 'ASK') {
                buyTrades++;
                buyVol += tr.volume;
            }
        }

        const sellTradesPerSec = sellTrades / windowSec;
        const buyTradesPerSec = buyTrades / windowSec;
        const sellVolPerSec = sellVol / windowSec;
        const buyVolPerSec = buyVol / windowSec;

        return {
            sellTradesPerSec,
            buyTradesPerSec,
            sellVolPerSec,
            buyVolPerSec,
            imbalanceTradesPerSec: buyTradesPerSec - sellTradesPerSec,
            imbalanceVolPerSec: buyVolPerSec - sellVolPerSec
        };
    }

    resetStats() {
        const now = Date.now();

        this.stats = {
            sellCount: 0,
            buyCount: 0,
            sellVolume: 0,
            buyVolume: 0,
            startTime: now
        };

        this.recentTrades = [];

        if (this.eventEngine) this.eventEngine.reset();
        if (this.transitionEngine?.reset) this.transitionEngine.reset();
        if (this.velocityPulseEngine) this.velocityPulseEngine.reset();

    }

    startStatsUpdate() {
        setInterval(() => this.updateStatsDisplay(), 100);
    }

    updateStatsDisplay() {
        const setText = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        };

        // Totals
        setText('sell-count', this.stats.sellCount);
        setText('buy-count', this.stats.buyCount);
        setText('sell-volume', this.stats.sellVolume);
        setText('buy-volume', this.stats.buyVolume);

        // Rolling rates
        const r = this.computeRollingRates();
        // Keep velocity pulse engine updated (it decides the active side + rate)
        if (this.velocityPulseEngine) {
            this.velocityPulseEngine.updateFromRates({
                buyTradesPerSec: r.buyTradesPerSec,
                sellTradesPerSec: r.sellTradesPerSec,
                buyVolPerSec: r.buyVolPerSec,
                sellVolPerSec: r.sellVolPerSec,
                ts: performance.now()
            });
        }

        // Keep the visual VU meter aligned with VelocityPulseEngine audio output.
        // (Audio pulses are scheduled inside the engine; we mirror its current loudness + active side here.)
        if (this.audioAlertMode === 'velocity' && this.velocityPulseEngine && this.velocityPulseEngine.activeSide) {
            const eng = this.velocityPulseEngine;
            const side = eng.activeSide;

            // Recreate the engine's pseudo-volume calculation (vol/sec above adaptive baseline)
            const vps = eng.latest?.[side]?.vps ?? 0;
            if (typeof eng._volScoreZ === 'function' &&
                typeof eng._intensityFromZ === 'function' &&
                typeof eng._pseudoVolumeFromIntensity === 'function') {

                const volZ = eng._volScoreZ(side, vps);
                const volI = eng._intensityFromZ(volZ, eng.config?.fullScaleZVol ?? 6);
                const pseudoVol = eng._pseudoVolumeFromIntensity(volI);

                this.vuMeter.updateVolume(side, pseudoVol);
            }
        }




        if (this.imbalanceMeter) {
            this.imbalanceMeter.update(r.imbalanceVolPerSec);
        }

        setText('sell-trades-per-sec', r.sellTradesPerSec.toFixed(1));
        setText('buy-trades-per-sec', r.buyTradesPerSec.toFixed(1));
        setText('sell-vol-per-sec', r.sellVolPerSec.toFixed(1));
        setText('buy-vol-per-sec', r.buyVolPerSec.toFixed(1));

        setText('imbalance-trades-per-sec', r.imbalanceTradesPerSec.toFixed(1));
        setText('imbalance-vol-per-sec', r.imbalanceVolPerSec.toFixed(1));

        // Volume per trade (from cumulative stats)
        const sellVolPerTrade = this.stats.sellCount > 0
        ? this.stats.sellVolume / this.stats.sellCount
        : 0;

        const buyVolPerTrade = this.stats.buyCount > 0
        ? this.stats.buyVolume / this.stats.buyCount
        : 0;

        // % greater than 1 contract per trade
        const sellPctGreater = (sellVolPerTrade - 1) * 100;
        const buyPctGreater  = (buyVolPerTrade  - 1) * 100;

        // Display (no threshold, no logic)
        setText('sell-vol-per-trade', `${sellPctGreater.toFixed(0)}%`);
        setText('buy-vol-per-trade',  `${buyPctGreater.toFixed(0)}%`);


        const totalEventsPerSec = (r.sellTradesPerSec + r.buyTradesPerSec);
        setText('events-per-sec', totalEventsPerSec.toFixed(1));
    }
}

// Initialize app when DOM is ready
let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new TradeFlowApp();
});