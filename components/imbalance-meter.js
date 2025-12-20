// imbalance-meter.js
// Segmented center-zero delta bar (no peak line, no center line)
// - Builds left (sell) or right (buy)
// - Quantized to 0.1 increments (10 segments each side)
// - Scale controlled by maxAbs (default 50)

class ImbalanceMeter {
  constructor(canvasId, options = {}) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) throw new Error(`ImbalanceMeter: canvas not found: ${canvasId}`);
    this.ctx = this.canvas.getContext('2d');

    // Full-scale delta (vol/sec). Example: 50 means +/-50 = full bar.
    this.maxAbs = options.maxAbs ?? 50;

    // 10 segments = 0.1 increments of full scale
    this.segments = options.segments ?? 10;

    // Optional smoothing (set to 0 to fully “step”)
    this.smoothing = options.smoothing ?? 0.25;

    // Style
    this.bg = options.bg ?? '#111';
    this.green = options.green ?? '#2e7d32';
    this.red = options.red ?? '#c62828';
    this.segmentGap = options.segmentGap ?? 2;
    this.padding = options.padding ?? 6;

    this.value = 0;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas);
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.render();
  }

  setScale(maxAbs) {
    this.maxAbs = Math.max(1, Number(maxAbs) || 1);
  }

  update(rawValue) {
    const v = Number(rawValue) || 0;

    // Smooth (optional)
    this.value = this.value + (v - this.value) * this.smoothing;

    this.render();
  }

  render() {
    const ctx = this.ctx;
    const w = this.canvas.getBoundingClientRect().width;
    const h = this.canvas.getBoundingClientRect().height;

    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = this.bg;
    ctx.fillRect(0, 0, w, h);

    const midX = w / 2;
    const pad = this.padding;

    // Normalize [-1..1]
    const norm = Math.max(-1, Math.min(1, this.value / this.maxAbs));
    const half = (w / 2) - pad;
    const barW = Math.abs(norm) * half;
    const top = pad;
    const barH = h - pad * 2;

    // Draw bar from center
    if (norm > 0) {
    ctx.fillStyle = this.green;
    ctx.fillRect(midX, top, barW, barH);
    } else if (norm < 0) {
    ctx.fillStyle = this.red;
    ctx.fillRect(midX - barW, top, barW, barH);
    }

    // Optional: draw a faint “track” so it never looks empty
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(pad, top, w - pad * 2, barH);

    // Re-draw bar on top so track stays behind
    if (norm > 0) {
    ctx.fillStyle = this.green;
    ctx.fillRect(midX, top, barW, barH);
    } else if (norm < 0) {
    ctx.fillStyle = this.red;
    ctx.fillRect(midX - barW, top, barW, barH);
    }

    // Label
    ctx.fillStyle = '#bbb';
    ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const shown = Math.max(-this.maxAbs, Math.min(this.maxAbs, this.value));
    ctx.fillText(`${shown.toFixed(1)} Δ v/s`, midX, h / 2);

  }
}
