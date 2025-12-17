// VU Meter Visualization
class VUMeter {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        
        if (!this.canvas) {
            console.error('Canvas element not found:', canvasId);
            return;
        }
        
        this.ctx = this.canvas.getContext('2d');
        this.sensitivity = 1.0;
        
        // Meter state
        this.leftLevel = 0;
        this.rightLevel = 0;
        this.leftPeak = 0;
        this.rightPeak = 0;
        this.leftPeakHold = 0;
        this.rightPeakHold = 0;
        
        // Animation
        this.animationId = null;
        
        // Resize canvas to match display size
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
        
        // Start animation loop
        this.animate();
    }
    
    resizeCanvas() {
        if (!this.canvas) return;
        
        const rect = this.canvas.getBoundingClientRect();
        this.canvas.width = rect.width * window.devicePixelRatio;
        this.canvas.height = rect.height * window.devicePixelRatio;
        this.ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
        this.width = rect.width;
        this.height = rect.height;
    }
    
    // Update meter with new volume
    updateVolume(side, volume) {
        // Convert volume to level (0-1)
        const level = Math.min(Math.sqrt(volume / 100) * this.sensitivity, 1.0);
        
        if (side === 'BID') {
            this.leftLevel = Math.max(this.leftLevel, level);
            if (level > this.leftPeak) {
                this.leftPeak = level;
                this.leftPeakHold = 30; // Hold for 30 frames (~0.5 seconds)
            }
        } else {
            this.rightLevel = Math.max(this.rightLevel, level);
            if (level > this.rightPeak) {
                this.rightPeak = level;
                this.rightPeakHold = 30;
            }
        }
    }
    
    // Set sensitivity (0-1)
    setSensitivity(sensitivity) {
        this.sensitivity = Math.max(0, Math.min(1, sensitivity));
    }
    
    // Animation loop
    animate() {
        if (!this.canvas) return;
        
        this.draw();
        
        // Decay levels
        this.leftLevel *= 0.85;
        this.rightLevel *= 0.85;
        
        // Decay peaks
        if (this.leftPeakHold > 0) {
            this.leftPeakHold--;
        } else {
            this.leftPeak *= 0.95;
        }
        
        if (this.rightPeakHold > 0) {
            this.rightPeakHold--;
        } else {
            this.rightPeak *= 0.95;
        }
        
        this.animationId = requestAnimationFrame(() => this.animate());
    }
    
    // Draw the meter
    draw() {
        if (!this.ctx || !this.canvas) return;
        
        const ctx = this.ctx;
        const width = this.width;
        const height = this.height;
        
        // Clear canvas
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, width, height);
        
        // Meter dimensions
        const meterWidth = width * 0.4;
        const meterHeight = height * 0.85;
        const meterX = width * 0.05;
        const meterY = height * 0.075;
        const spacing = width * 0.1;
        
        // Draw left meter (SELL/BID)
        this.drawMeter(ctx, meterX, meterY, meterWidth, meterHeight, this.leftLevel, this.leftPeak, 'left');
        
        // Draw right meter (BUY/ASK)
        this.drawMeter(ctx, meterX + meterWidth + spacing, meterY, meterWidth, meterHeight, this.rightLevel, this.rightPeak, 'right');
    }
    
    drawMeter(ctx, x, y, width, height, level, peak, side) {
        // Background
        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.fillRect(x, y, width, height);
        
        // Color zones (green, yellow, red)
        const greenHeight = height * 0.7;
        const yellowHeight = height * 0.2;
        
        // Draw level bar
        const levelHeight = height * level;
        
        // Calculate colors based on level position
        if (levelHeight > 0) {
            if (levelHeight <= greenHeight) {
                // Green zone
                const gradient = ctx.createLinearGradient(x, y + height, x, y + height - levelHeight);
                gradient.addColorStop(0, side === 'left' ? '#ff4444' : '#44ff44');
                gradient.addColorStop(1, side === 'left' ? '#ff6666' : '#66ff66');
                ctx.fillStyle = gradient;
                ctx.fillRect(x, y + height - levelHeight, width, levelHeight);
            } else if (levelHeight <= greenHeight + yellowHeight) {
                // Green + Yellow zones
                const greenGradient = ctx.createLinearGradient(x, y + height, x, y + height - greenHeight);
                greenGradient.addColorStop(0, side === 'left' ? '#ff4444' : '#44ff44');
                greenGradient.addColorStop(1, side === 'left' ? '#ff6666' : '#66ff66');
                ctx.fillStyle = greenGradient;
                ctx.fillRect(x, y + height - greenHeight, width, greenHeight);
                
                // Yellow part
                ctx.fillStyle = '#ffcc00';
                ctx.fillRect(x, y + height - levelHeight, width, levelHeight - greenHeight);
            } else {
                // All zones
                const greenGradient = ctx.createLinearGradient(x, y + height, x, y + height - greenHeight);
                greenGradient.addColorStop(0, side === 'left' ? '#ff4444' : '#44ff44');
                greenGradient.addColorStop(1, side === 'left' ? '#ff6666' : '#66ff66');
                ctx.fillStyle = greenGradient;
                ctx.fillRect(x, y + height - greenHeight, width, greenHeight);
                
                // Yellow part
                ctx.fillStyle = '#ffcc00';
                ctx.fillRect(x, y + height - greenHeight - yellowHeight, width, yellowHeight);
                
                // Red part
                const redGradient = ctx.createLinearGradient(x, y + height - greenHeight - yellowHeight, x, y + height - levelHeight);
                redGradient.addColorStop(0, '#ff0000');
                redGradient.addColorStop(1, '#ff4444');
                ctx.fillStyle = redGradient;
                ctx.fillRect(x, y + height - levelHeight, width, levelHeight - greenHeight - yellowHeight);
            }
        }
        
        // Draw peak indicator
        if (peak > 0.01) {
            const peakY = y + height - (height * peak);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(x, peakY - 2, width, 3);
        }
        
        // Draw scale lines
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 1;
        
        for (let i = 0; i <= 10; i++) {
            const lineY = y + (height * i / 10);
            ctx.beginPath();
            ctx.moveTo(x, lineY);
            ctx.lineTo(x + width, lineY);
            ctx.stroke();
        }
        
        // Draw border
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, width, height);
    }
}