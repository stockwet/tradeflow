/**
 * Audio Engine - Handles real-time audio synthesis with stereo positioning
 * Similar to TickStrike's audio implementation
 */

class AudioEngine {
    constructor() {
        this.audioCtx = null;
        this.masterGain = null;
        this.bidFrequency = 100;   // Lower pitch for BID/SELL
        this.askFrequency = 1000;   // Higher pitch for ASK/BUY
        this.volume = 0.8;          // Master volume
        this.isInitialized = false;
    }

    /**
     * Initialize the audio context (must be called after user interaction)
     */
    init() {
        if (this.isInitialized) return;

        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        this.masterGain = this.audioCtx.createGain();
        this.masterGain.gain.value = this.volume;
        this.masterGain.connect(this.audioCtx.destination);
        
        this.isInitialized = true;
        console.log('Audio Engine initialized');
    }

    /**
     * Play a trade tick sound
     * @param {string} side - 'BID' or 'ASK'
     * @param {number} volume - Trade volume (will be normalized)
     * @param {number} duration - Duration in seconds (default 0.075)
     */
    playTrade(side, volume, duration = 0.075) {
        if (!this.isInitialized) {
            console.warn('Audio not initialized');
            return;
        }

        // Create oscillator for tone generation
        const oscillator = this.audioCtx.createOscillator();
        const gainNode = this.audioCtx.createGain();
        const panner = this.audioCtx.createStereoPanner();

        // Set frequency based on side
        oscillator.frequency.value = side === 'BID' ? this.bidFrequency : this.askFrequency;

        // Set stereo position
        // -1.0 = full left (SELL/BID), +1.0 = full right (BUY/ASK)
        panner.pan.value = side === 'BID' ? -1.0 : 1.0;

        // Calculate gain based on volume (normalize to reasonable range)
        const normalizedGain = Math.min(volume / 1000, 1.0) * this.volume;
        gainNode.gain.value = normalizedGain;

        // Connect audio graph
        oscillator.connect(gainNode);
        gainNode.connect(panner);
        panner.connect(this.masterGain);

        // Play the tone
        const now = this.audioCtx.currentTime;
        
        // Add slight envelope for smoother sound
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(normalizedGain, now + 0.005);
        gainNode.gain.setValueAtTime(normalizedGain, now + duration - 0.01);
        gainNode.gain.linearRampToValueAtTime(0, now + duration);

        oscillator.start(now);
        oscillator.stop(now + duration);

        return {
            side: side,
            volume: volume,
            normalizedGain: normalizedGain
        };
    }

    /**
     * Update master volume
     * @param {number} volume - Volume level (0-1)
     */
    setVolume(volume) {
        this.volume = Math.max(0, Math.min(1, volume));
        if (this.masterGain) {
            this.masterGain.gain.value = this.volume;
        }
    }

    /**
     * Update BID frequency
     * @param {number} freq - Frequency in Hz
     */
    setBidFrequency(freq) {
        this.bidFrequency = freq;
    }

    /**
     * Update ASK frequency
     * @param {number} freq - Frequency in Hz
     */
    setAskFrequency(freq) {
        this.askFrequency = freq;
    }

    /**
     * Resume audio context (needed for some browsers)
     */
    resume() {
        if (this.audioCtx && this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }
    }

    /**
     * Get current audio context state
     */
    getState() {
        return this.audioCtx ? this.audioCtx.state : 'uninitialized';
    }
}

// Make available globally
window.AudioEngine = AudioEngine;