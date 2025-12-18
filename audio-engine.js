/**
 * Audio Engine - Handles real-time audio synthesis with stereo positioning
 * Updated with aggressive perceptual volume scaling for wider dynamic range
 */

class AudioEngine {
    constructor() {
        this.audioCtx = null;
        this.masterGain = null;
        this.bidFrequency = 100;   // Lower pitch for BID/SELL
        this.askFrequency = 1000;   // Higher pitch for ASK/BUY
        this.volume = 0.8;          // Master volume
        this.isInitialized = false;
        
        // Volume scaling tuning parameters (exposed for easy adjustment)
        this.volumeFloor = 0.08;      // Minimum audible level (0.02-0.15 range)
        this.volumePowerCurve = 0.35; // Aggression (0.3 = very aggressive, 0.5 = moderate, 0.7 = gentle)
        this.volumeMaxGain = 0.9;     // Maximum gain ceiling (0.7-1.0 range)
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

        // Calculate gain based on volume with aggressive perceptual curve
        // This creates WIDE dynamic range so small vs large ticks are very audible
        const v = Math.max(0, Number(volume) || 0);
        
        // Power curve scaling: volume^0.35 gives MUCH wider perceived range
        // Examples with default settings (floor=0.08, curve=0.35, max=0.9):
        //   volume=1   → gain ≈ 0.08 (floor, very quiet)
        //   volume=5   → gain ≈ 0.20 (noticeable)
        //   volume=10  → gain ≈ 0.28 (moderate)
        //   volume=25  → gain ≈ 0.40 (strong)
        //   volume=50  → gain ≈ 0.54 (loud)
        //   volume=100 → gain ≈ 0.72 (very loud)
        const normalized = Math.min(v / 100, 1.0);  // Normalize to 0-1 range
        const curved = Math.pow(normalized, this.volumePowerCurve);
        
        // Combine floor + curved response
        const shaped = this.volumeFloor + (curved * (this.volumeMaxGain - this.volumeFloor));
        
        // Final gain
        const normalizedGain = Math.min(shaped, this.volumeMaxGain) * this.volume;

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
     * @param {number} volume - Volume level (0-2, where 1.0 is 100%)
     */
    setVolume(volume) {
        this.volume = Math.max(0, Math.min(2, volume));
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
     * Advanced tuning for volume response curve
     * Call from console: app.audioEngine.tuneVolume(0.10, 0.30, 0.85)
     * @param {number} floor - Minimum volume (0.02-0.15)
     * @param {number} powerCurve - Response curve (0.3=aggressive, 0.5=moderate, 0.7=gentle)
     * @param {number} maxGain - Maximum gain ceiling (0.7-1.0)
     */
    tuneVolume(floor, powerCurve, maxGain) {
        this.volumeFloor = floor || this.volumeFloor;
        this.volumePowerCurve = powerCurve || this.volumePowerCurve;
        this.volumeMaxGain = maxGain || this.volumeMaxGain;
        
        console.log('Audio volume curve tuned:', {
            floor: this.volumeFloor,
            powerCurve: this.volumePowerCurve,
            maxGain: this.volumeMaxGain
        });
        
        // Show example outputs
        console.log('Example volumes:');
        for (const vol of [1, 5, 10, 25, 50, 100]) {
            const normalized = Math.min(vol / 100, 1.0);
            const curved = Math.pow(normalized, this.volumePowerCurve);
            const shaped = this.volumeFloor + (curved * (this.volumeMaxGain - this.volumeFloor));
            console.log(`  vol=${vol} → gain=${shaped.toFixed(3)}`);
        }
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