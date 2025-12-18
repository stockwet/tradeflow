// CSV Data Player
class DataPlayer {
    constructor() {
        this.data = [];
        this.currentIndex = 0;
        this.isPlaying = false;
        this.playbackSpeed = 1.0;
        this.callback = null;
        this.timeoutId = null;
    }
    
    // Load CSV data
    loadCSV(csvText) {
        const lines = csvText.trim().split('\n');
        const header = lines[0].split(',');
        
        this.data = [];
        
        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',');
            if (values.length < 4) continue;
            
            const trade = {
                timestamp: parseInt(values[0]),
                price: parseFloat(values[1]),
                volume: parseFloat(values[2]),
                side: values[3].trim()
            };
            
            this.data.push(trade);
        }
        
        console.log('Loaded', this.data.length, 'trades');
        this.currentIndex = 0;
    }
    
    // Start playback
    play(callback) {
        if (!this.data || this.data.length === 0) {
            console.error('No data loaded');
            return;
        }
        
        this.callback = callback;
        this.isPlaying = true;
        this.playNext();
    }
    
    // Pause playback
    pause() {
        this.isPlaying = false;
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }
    }
    
    // Stop playback and reset
    stop() {
        this.pause();
        this.currentIndex = 0;
    }
    
    // Set playback speed
    setPlaybackSpeed(speed) {
        this.playbackSpeed = speed;
    }
    
    // Play next trade
    playNext() {
        if (!this.isPlaying || this.currentIndex >= this.data.length) {
            this.isPlaying = false;
            this.currentIndex = 0;
            return;
        }
        
        const trade = this.data[this.currentIndex];
        
        // Call callback with trade data
        if (this.callback) {
            this.callback(trade);
        }
        
        // Calculate delay until next trade
        let delay = 0;
        if (this.currentIndex < this.data.length - 1) {
            const nextTrade = this.data[this.currentIndex + 1];
            delay = (nextTrade.timestamp - trade.timestamp) / this.playbackSpeed;
        }
        
        this.currentIndex++;
        
        // Schedule next trade
        this.timeoutId = setTimeout(() => this.playNext(), delay);
    }
}