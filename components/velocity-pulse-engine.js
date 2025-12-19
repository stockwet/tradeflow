// velocity-pulse-engine.js
// Pace = trades/sec (adaptive baseline)
// Loudness = vol/sec (adaptive baseline)
// One-side dominant playback with hysteresis for clean reversals.

class VelocityPulseEngine {
  constructor(audioEngine, config = {}) {
    this.audioEngine = audioEngine;

    this.config = {
      // Baselines
      baselineWindowMs: 45000,   // ~45s adaptive time constant
      sensitivityK: 1.0,         // threshold = ema + K*dev (for both pace & vol)
      minAbsTradesPerSec: 4.0,   // hard floor for pace gating
      minAbsVolPerSec: 7.0,     // hard floor for loudness baseline

      // One-side selection / reversal behavior
      switchMarginZ: 0.6,        // new side must exceed current by this margin (pace score)
      minSwitchMs: 60,           // guard against thrash

      // Pulse generation (machine gun feel)
      minRate: 3,                // clicks/sec when barely above threshold
      maxRate: 28,               // cap clicks/sec
      rateCurve: 1.7,            // ramp curve for intensity->rate
      clickDurationSec: 0.045,

      // Loudness mapping (pseudo-volume -> AudioEngine curve)
      minPseudoVolume: 4,
      maxPseudoVolume: 100,
      fullScaleZVol: 3.0,        // z where loudness intensity ~1.0

      // Pace normalization
      fullScaleZPace: 3.0,       // z where pace intensity ~1.0

      ...config
    };

    // Per-side baseline state for pace & vol
    this.state = {
      BID: {
        pace: { ema: 0, dev: 1, init: false, lastTs: 0 },
        vol:  { ema: 0, dev: 1, init: false, lastTs: 0 }
      },
      ASK: {
        pace: { ema: 0, dev: 1, init: false, lastTs: 0 },
        vol:  { ema: 0, dev: 1, init: false, lastTs: 0 }
      }
    };

    this.latest = {
      ts: performance.now(),
      BID: { tps: 0, vps: 0 },   // BID = sells
      ASK: { tps: 0, vps: 0 }    // ASK = buys
    };

    this.activeSide = null;
    this.activePaceZ = 0;
    this.lastSwitchAt = 0;

    this.nextFireAt = 0;
    this.timer = null;
  }

  start() {
    if (this.timer) return;
    this.nextFireAt = performance.now();
    this.timer = setInterval(() => this._tick(), 10);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  reset() {
    this.activeSide = null;
    this.activePaceZ = 0;
    this.lastSwitchAt = 0;
    this.nextFireAt = performance.now();

    for (const side of ['BID', 'ASK']) {
      this.state[side].pace = { ema: 0, dev: 1, init: false, lastTs: 0 };
      this.state[side].vol  = { ema: 0, dev: 1, init: false, lastTs: 0 };
    }
  }

  updateConfig(patch = {}) {
    this.config = { ...this.config, ...patch };
  }

  // Call with rolling stats from app.js (per window)
  updateFromRates({
    buyTradesPerSec, sellTradesPerSec,
    buyVolPerSec, sellVolPerSec,
    ts = performance.now()
  }) {
    // Map to app side convention
    this.latest.ts = ts;

    this.latest.ASK.tps = Number(buyTradesPerSec) || 0;
    this.latest.BID.tps = Number(sellTradesPerSec) || 0;

    this.latest.ASK.vps = Number(buyVolPerSec) || 0;
    this.latest.BID.vps = Number(sellVolPerSec) || 0;

    // Update baselines
    this._updateBaseline('ASK', 'pace', this.latest.ASK.tps, ts);
    this._updateBaseline('BID', 'pace', this.latest.BID.tps, ts);

    this._updateBaseline('ASK', 'vol', this.latest.ASK.vps, ts);
    this._updateBaseline('BID', 'vol', this.latest.BID.vps, ts);

    // Choose active side based on PACE (trades/sec)
    this._selectActiveSide(ts);
  }

  _alpha(dtMs) {
    const tau = Math.max(2000, this.config.baselineWindowMs);
    return 1 - Math.exp(-dtMs / tau);
  }

  _seedDev(value) {
    return Math.max(1e-3, value * 0.25 + 1);
  }

  _updateBaseline(side, channel, value, ts) {
    const st = this.state[side][channel];

    if (!st.init) {
      st.ema = value;
      st.dev = this._seedDev(value);
      st.init = true;
      st.lastTs = ts;
      return;
    }

    const dt = Math.max(1, ts - (st.lastTs || ts));
    st.lastTs = ts;

    const a = this._alpha(dt);
    st.ema = st.ema + a * (value - st.ema);

    // EMA of absolute deviation
    const absErr = Math.abs(value - st.ema);
    st.dev = Math.max(1e-3, st.dev + a * (absErr - st.dev));
  }

  _paceThreshold(side) {
    const st = this.state[side].pace;
    const adaptive = st.ema + this.config.sensitivityK * st.dev;
    return Math.max(this.config.minAbsTradesPerSec, adaptive);
  }

  _volThreshold(side) {
    const st = this.state[side].vol;
    const adaptive = st.ema + this.config.sensitivityK * st.dev;
    return Math.max(this.config.minAbsVolPerSec, adaptive);
  }

  _paceScoreZ(side, tps) {
    const st = this.state[side].pace;
    const thr = this._paceThreshold(side);
    const denom = Math.max(1e-3, st.dev);
    return (tps - thr) / denom;
  }

  _volScoreZ(side, vps) {
    const st = this.state[side].vol;
    const thr = this._volThreshold(side);
    const denom = Math.max(1e-3, st.dev);
    return (vps - thr) / denom;
  }

  _selectActiveSide(ts) {
    const bidTPS = this.latest.BID.tps;
    const askTPS = this.latest.ASK.tps;

    const bidZ = this._paceScoreZ('BID', bidTPS);
    const askZ = this._paceScoreZ('ASK', askTPS);

    let candidate = null;
    let candZ = 0;

    if (bidZ > 0 || askZ > 0) {
      if (askZ >= bidZ) { candidate = 'ASK'; candZ = askZ; }
      else { candidate = 'BID'; candZ = bidZ; }
    }

    if (!candidate) {
      this.activeSide = null;
      this.activePaceZ = 0;
      return;
    }

    if (!this.activeSide) {
      this.activeSide = candidate;
      this.activePaceZ = candZ;
      this.lastSwitchAt = ts;
      this.nextFireAt = performance.now();
      return;
    }

    if (candidate === this.activeSide) {
      this.activePaceZ = candZ;
      return;
    }

    if (ts - this.lastSwitchAt < this.config.minSwitchMs) return;

    // Candidate must beat current by margin
    if (candZ >= this.activePaceZ + this.config.switchMarginZ) {
      this.activeSide = candidate;
      this.activePaceZ = candZ;
      this.lastSwitchAt = ts;
      this.nextFireAt = performance.now();
    }
  }

  _intensityFromZ(z, fullScaleZ) {
    const i = Math.max(0, Math.min(1, z / Math.max(1e-3, fullScaleZ)));
    return i;
  }

  _rateFromIntensity(i) {
    const { minRate, maxRate, rateCurve } = this.config;
    const shaped = Math.pow(i, rateCurve);
    return minRate + shaped * (maxRate - minRate);
  }

  _pseudoVolumeFromIntensity(i) {
    const { minPseudoVolume, maxPseudoVolume } = this.config;
    return minPseudoVolume + i * (maxPseudoVolume - minPseudoVolume);
  }

  _tick() {
    if (!this.activeSide) return;

    const now = performance.now();
    if (now < this.nextFireAt) return;

    // Pace intensity (controls rate)
    const paceI = this._intensityFromZ(this.activePaceZ, this.config.fullScaleZPace);
    const rate = this._rateFromIntensity(paceI);

    // Loudness intensity (controls pseudo-volume) based on VOL/sec above baseline
    const vps = this.latest[this.activeSide].vps;
    const volZ = this._volScoreZ(this.activeSide, vps);
    const volI = this._intensityFromZ(volZ, this.config.fullScaleZVol);

    const pseudoVol = this._pseudoVolumeFromIntensity(volI);

    this.audioEngine.playTrade(this.activeSide, pseudoVol, this.config.clickDurationSec);

    const intervalMs = 1000 / Math.max(0.1, rate);
    this.nextFireAt = now + intervalMs;
  }
}

// Make available globally
window.VelocityPulseEngine = VelocityPulseEngine;
