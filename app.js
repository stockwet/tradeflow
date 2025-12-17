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
        // 'raw' plays every tick (current behavior)
        // 'intelligent' only plays when EventEngine emits a flow event
        // this.audioAlertMode = 'raw';
        this.audioAlertMode = 'intelligent';


        // Event Engine (optional, but recommended)
        // Requires event-engine.js to be loaded before app.js in index.html
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

    initializeEventEngine() {
        if (typeof EventEngine === 'undefined') {
            console.warn('EventEngine not found. Ensure event-engine.js is loaded before app.js.');
            return;
        }

        // Baseline defaults; you’ll likely tune these per instrument.
        this.eventEngine = new EventEngine({
            windowMs: 300,
            dominanceMetric: 'volume',

            enterDominance: 0.80,
            exitDominance: 0.65,

            minTradesPerSec: 35,

            maxEventsPerSec: 8,

            requireSustainedMs: 80,
            lockSideMs: 150,

            cooldownMs: 0,
            debug: false
        });

    }

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

        volumeSlider.addEventListener('input', (e) => {
            const volume = parseInt(e.target.value, 10) / 100;
            this.audioEngine.setVolume(volume);
            volumeValue.textContent = e.target.value + '%';
        });

        // BID frequency control
        const bidFreqSlider = document.getElementById('bid-frequency');
        const bidFreqValue = document.getElementById('bid-freq-value');

        bidFreqSlider.addEventListener('input', (e) => {
            const freq = parseInt(e.target.value, 10);
            this.audioEngine.setBidFrequency(freq);
            bidFreqValue.textContent = freq + ' Hz';
        });

        // ASK frequency control
        const askFreqSlider = document.getElementById('ask-frequency');
        const askFreqValue = document.getElementById('ask-freq-value');

        askFreqSlider.addEventListener('input', (e) => {
            const freq = parseInt(e.target.value, 10);
            this.audioEngine.setAskFrequency(freq);
            askFreqValue.textContent = freq + ' Hz';
        });

        // Sensitivity control
        const sensitivitySlider = document.getElementById('sensitivity');
        const sensitivityValue = document.getElementById('sensitivity-value');

        sensitivitySlider.addEventListener('input', (e) => {
            const sensitivity = parseInt(e.target.value, 10) / 100;
            this.vuMeter.setSensitivity(sensitivity);
            sensitivityValue.textContent = e.target.value + '%';
        });

        // Data mode toggle (Live / Playback)
        const modeToggle = document.getElementById('data-mode');
        modeToggle.addEventListener('change', (e) => {
            this.dataMode = e.target.value;
            this.updateUIForMode();
        });

        // Playback controls
        document.getElementById('play-btn').addEventListener('click', () => this.handlePlay());
        document.getElementById('pause-btn').addEventListener('click', () => this.handlePause());
        document.getElementById('stop-btn').addEventListener('click', () => this.handleStop());

        // File upload
        document.getElementById('csv-file').addEventListener('change', (e) => {
            this.handleFileUpload(e.target.files[0]);
        });

        // Speed control
        const speedSlider = document.getElementById('playback-speed');
        const speedValue = document.getElementById('speed-value');

        speedSlider.addEventListener('input', (e) => {
            const speed = parseFloat(e.target.value);
            this.dataPlayer.setPlaybackSpeed(speed);
            speedValue.textContent = speed.toFixed(1) + 'x';
        });

        // Reset stats button
        document.getElementById('reset-stats-btn').addEventListener('click', () => {
            this.resetStats();
            this.updateStatsDisplay();
        });

        // WebSocket reconnect button
        document.getElementById('reconnect-btn').addEventListener('click', () => {
            this.connectWebSocket();
        });

        this.updateUIForMode();
    }

    updateUIForMode() {
        const playbackControls = document.getElementById('playback-controls');
        const websocketStatus = document.getElementById('websocket-status');

        if (this.dataMode === 'websocket') {
            playbackControls.style.display = 'none';
            websocketStatus.style.display = 'block';
        } else {
            playbackControls.style.display = 'block';
            websocketStatus.style.display = 'none';
        }
    }

    connectWebSocket() {
        // Connect to socket reader running in Windows VM
        const WS_URL = 'ws://10.211.55.5:8080';  // Change this to your Windows VM IP
        const statusEl = document.getElementById('connection-status');
        const reconnectBtn = document.getElementById('reconnect-btn');

        statusEl.textContent = 'Connecting...';
        statusEl.className = 'status connecting';
        reconnectBtn.disabled = true;

        try {
            this.websocket = new WebSocket(WS_URL);

            this.websocket.onopen = () => {
                console.log('Connected to socket reader WebSocket');

                // Initialize audio when connection opens (note: may still require user gesture in some environments)
                // Leaving this in because it’s in your current file; if you see autoplay issues, we can remove it.
                this.audioEngine.init();

                this.connectionStatus = 'connected';
                statusEl.textContent = 'Connected';
                statusEl.className = 'status connected';
                reconnectBtn.disabled = true;

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
                statusEl.textContent = 'Disconnected';
                statusEl.className = 'status disconnected';
                reconnectBtn.disabled = false;

                // Try to reconnect after 5 seconds
                setTimeout(() => {
                    if (this.connectionStatus === 'disconnected' && this.dataMode === 'websocket') {
                        console.log('Attempting to reconnect...');
                        this.connectWebSocket();
                    }
                }, 5000);
            };

        } catch (err) {
            console.error('Failed to create WebSocket:', err);
            statusEl.textContent = 'Error';
            statusEl.className = 'status disconnected';
            reconnectBtn.disabled = false;
        }
    }

    // Unified trade processing for both Live and Playback
    processTrade(trade) {
        // Normalize (defensive)
        const side = trade.side;
        const volume = Number(trade.volume);

        if (side !== 'BID' && side !== 'ASK') return;
        if (!Number.isFinite(volume)) return;

        // Always update visuals/stats from raw trades (you can change this later if you want visuals to reflect events)
        this.vuMeter.updateVolume(side, volume);
        this.updateStats(side, volume);

        // Audio output
        if (this.audioAlertMode === 'raw' || !this.eventEngine) {
            // Raw tick audio
            this.audioEngine.playTrade(side, volume);
            return;
        }

        // Intelligent mode: ingest tick → maybe emit event
        const event = this.eventEngine.ingest(trade);
        if (!event) return;

        // Minimal mapping for v1:
        // Strength is 0..1, convert into a small pseudo-volume so clicks reflect dominance.
        const pseudoVolume = Math.max(1, Math.round(event.strength * 10));

        // Play dominant-side click
        this.audioEngine.playTrade(event.side, pseudoVolume);

        // Optional: you can also drive the meter differently here if you want event-only visualization later.
        // For now, visuals remain tick-accurate.
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

        // Reset before playback starts
        this.resetStats();

        this.dataPlayer.play((trade) => {
            // Playback trades should match: { timestamp, price, volume, side, symbol }
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
        }, 100);  // Update 10 times per second
    }

    updateStatsDisplay() {
        document.getElementById('sell-count').textContent = this.stats.sellCount;
        document.getElementById('buy-count').textContent = this.stats.buyCount;
        document.getElementById('sell-volume').textContent = this.stats.sellVolume;
        document.getElementById('buy-volume').textContent = this.stats.buyVolume;

        // Calculate events per second (raw trade rate)
        if (this.stats.startTime) {
            const elapsed = (Date.now() - this.stats.startTime) / 1000;
            const totalEvents = this.stats.sellCount + this.stats.buyCount;
            const eventsPerSec = elapsed > 0 ? (totalEvents / elapsed).toFixed(1) : '0.0';
            document.getElementById('events-per-sec').textContent = eventsPerSec;
        }
    }
}

// Initialize app when DOM is ready
let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new TradeFlowApp();
});
