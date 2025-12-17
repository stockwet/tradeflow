// Main application logic
class TradeFlowApp {
    constructor() {
        this.audioEngine = new AudioEngine();
        this.vuMeter = new VUMeter('vu-meter-canvas');
        this.dataPlayer = new DataPlayer();
        this.websocket = null;
        this.connectionStatus = 'disconnected';
        this.dataMode = 'websocket';  // 'websocket' or 'playback'
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
    
    initializeUI() {
        // Enable audio on first click
        document.addEventListener('click', () => {
            if (!this.audioEngine.isInitialized) {
                this.audioEngine.init();
                console.log('✓ Audio enabled');
            }
        }, { once: true });
        
        // Master volume control
        const volumeSlider = document.getElementById('master-volume');
        const volumeValue = document.getElementById('volume-value');
        
        volumeSlider.addEventListener('input', (e) => {
            const volume = parseInt(e.target.value) / 100;
            this.audioEngine.setVolume(volume);
            volumeValue.textContent = e.target.value + '%';
        });
        
        // Frequency control
        // BID frequency control
        const bidFreqSlider = document.getElementById('bid-frequency');
        const bidFreqValue = document.getElementById('bid-freq-value');

        bidFreqSlider.addEventListener('input', (e) => {
            const freq = parseInt(e.target.value);
            this.audioEngine.setBidFrequency(freq);
            bidFreqValue.textContent = freq + ' Hz';
        });

        // ASK frequency control
        const askFreqSlider = document.getElementById('ask-frequency');
        const askFreqValue = document.getElementById('ask-freq-value');

        askFreqSlider.addEventListener('input', (e) => {
            const freq = parseInt(e.target.value);
            this.audioEngine.setAskFrequency(freq);
            askFreqValue.textContent = freq + ' Hz';
        });
        // Sensitivity control
        const sensitivitySlider = document.getElementById('sensitivity');
        const sensitivityValue = document.getElementById('sensitivity-value');
        
        sensitivitySlider.addEventListener('input', (e) => {
            const sensitivity = parseInt(e.target.value) / 100;
            this.vuMeter.setSensitivity(sensitivity);
            sensitivityValue.textContent = e.target.value + '%';
        });
        
        // Data mode toggle
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
            this.updateStatsDisplay(); // Immediately update display to show zeros
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
                console.log('✓ Connected to socket reader WebSocket');
                // Initialize audio when connection opens
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
                console.log('✗ Disconnected from socket reader');
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
    
    handleTrade(trade) {
        if (this.dataMode !== 'websocket') return;
        
        const { side, volume, price } = trade;
        
        // Play audio
        this.audioEngine.playTrade(side, volume);
        
        // Update VU meters
        this.vuMeter.updateVolume(side, volume);
        
        // Update stats
        this.updateStats(side, volume);
    }
    
    handlePlay() {
        if (!this.dataPlayer.data || this.dataPlayer.data.length === 0) {
            alert('Please load a CSV file first');
            return;
        }
        
        this.dataPlayer.play((trade) => {
            this.audioEngine.playTrade(trade.side, trade.volume);
            this.vuMeter.updateVolume(trade.side, trade.volume);
            this.updateStats(trade.side, trade.volume);
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
            console.log('✓ CSV file loaded:', this.dataPlayer.data.length, 'trades');
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
        
        // Calculate events per second
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