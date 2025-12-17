// event-engine.js
// TradeFlow Event Engine
// Consumes raw trades and emits "flow events" when dominance + velocity thresholds are met.
// Designed to be deterministic, low-latency, and easy to tune.
// Exposes EventEngine as a global (window.EventEngine) for simple <script> usage.

(function () {
  class EventEngine {
    constructor(config = {}) {
      this.config = {
        // Rolling window
        windowMs: 200,                 // aggregation window length
        maxWindowTrades: 1000,         // safety cap (prevents runaway memory)

        // Dominance thresholds (hysteresis)
        enterDominance: 0.70,          // must exceed to ENTER a dominant state
        exitDominance: 0.60,           // must fall below to EXIT a dominant state

        // Activity thresholds
        minTradesPerSec: 20,           // must meet trade velocity
        minTotalVolumeInWindow: 0,     // optional: require some total volume within window

        // Event emission pacing
        maxEventsPerSec: 25,           // limit how chatty audio events get
        cooldownMs: 0,                 // optional: silence after an event (0 = none)

        // State behavior
        requireSustainedMs: 0,         // optional: dominance must persist for N ms before emitting
        lockSideMs: 0,                 // optional: once dominant, lock side for N ms (reduces flip-flop)

        // What metric determines dominance
        dominanceMetric: "volume",     // "volume" | "count"

        // Debug
        debug: false,

        ...config
      };

      this.reset();
    }

    reset() {
      this.window = []; // array of { timestamp, side, volume, price, symbol }
      this.state = {
        dominantSide: null,          // "ASK" | "BID" | null
        dominantSince: null,
        lockedUntil: 0,
        lastEmitAt: 0,
        cooldownUntil: 0
      };
      this.lastComputed = null;
    }

    updateConfig(partial) {
      this.config = { ...this.config, ...partial };
    }

    // Normalizes incoming trade shapes
    normalizeTrade(trade) {
      // Your app currently uses: { timestamp, price, volume, side, symbol } :contentReference[oaicite:1]{index=1}
      const timestamp = Number(trade.timestamp ?? trade.ts ?? Date.now());
      const side = trade.side ?? trade.s;
      const volume = Number(trade.volume ?? trade.v ?? 0);
      const price = Number(trade.price ?? trade.p ?? NaN);
      const symbol = trade.symbol ?? trade.sym ?? "";

      if (side !== "ASK" && side !== "BID") return null;
      if (!Number.isFinite(timestamp)) return null;
      if (!Number.isFinite(volume)) return null;

      return { timestamp, side, volume, price, symbol };
    }

    prune(nowTs) {
      const cutoff = nowTs - this.config.windowMs;

      // Drop old trades
      while (this.window.length && this.window[0].timestamp < cutoff) {
        this.window.shift();
      }

      // Safety cap
      if (this.window.length > this.config.maxWindowTrades) {
        this.window.splice(0, this.window.length - this.config.maxWindowTrades);
      }
    }

    compute(nowTs) {
      let buyVol = 0, sellVol = 0;
      let buyCount = 0, sellCount = 0;

      for (const t of this.window) {
        if (t.side === "ASK") {
          buyVol += t.volume;
          buyCount += 1;
        } else {
          sellVol += t.volume;
          sellCount += 1;
        }
      }

      const totalVol = buyVol + sellVol;
      const totalCount = buyCount + sellCount;

      const windowSec = this.config.windowMs / 1000;
      const tradesPerSec = windowSec > 0 ? totalCount / windowSec : 0;
      const volPerSec = windowSec > 0 ? totalVol / windowSec : 0;

      // Dominance by selected metric
      const denom = this.config.dominanceMetric === "count" ? totalCount : totalVol;
      const buyMetric = this.config.dominanceMetric === "count" ? buyCount : buyVol;
      const sellMetric = this.config.dominanceMetric === "count" ? sellCount : sellVol;

      const buyRatio = denom > 0 ? buyMetric / denom : 0;
      const sellRatio = denom > 0 ? sellMetric / denom : 0;

      const computed = {
        nowTs,
        buyVol,
        sellVol,
        totalVol,
        buyCount,
        sellCount,
        totalCount,
        tradesPerSec,
        volPerSec,
        buyRatio,
        sellRatio
      };

      this.lastComputed = computed;
      return computed;
    }

    // Returns { side, strength, tradesPerSec, ... } or null
    ingest(trade) {
      const t = this.normalizeTrade(trade);
      if (!t) return null;

      const nowTs = t.timestamp;

      this.window.push(t);
      this.prune(nowTs);

      const s = this.compute(nowTs);

      // Cooldown
      if (nowTs < this.state.cooldownUntil) return null;

      // Activity thresholds
      if (s.tradesPerSec < this.config.minTradesPerSec) {
        this._maybeExitDominance(nowTs, s);
        return null;
      }
      if (s.totalVol < this.config.minTotalVolumeInWindow) {
        this._maybeExitDominance(nowTs, s);
        return null;
      }

      // Determine candidate dominance
      const buyDominant = s.buyRatio >= this.config.enterDominance;
      const sellDominant = s.sellRatio >= this.config.enterDominance;

      // If locked, prevent side flips until lock expires
      const locked = nowTs < this.state.lockedUntil;

      if (!locked) {
        if (buyDominant && !sellDominant) {
          this._enterOrContinue("ASK", nowTs);
        } else if (sellDominant && !buyDominant) {
          this._enterOrContinue("BID", nowTs);
        } else {
          // Balanced or conflicting
          this._maybeExitDominance(nowTs, s);
          return null;
        }
      } else {
        // Locked: still allow exit if dominance collapses
        this._maybeExitDominance(nowTs, s);
      }

      // Sustained requirement
      if (
        this.config.requireSustainedMs > 0 &&
        this.state.dominantSince != null &&
        nowTs - this.state.dominantSince < this.config.requireSustainedMs
      ) {
        return null;
      }

      // Emit pacing
      const minInterval = 1000 / Math.max(1, this.config.maxEventsPerSec);
      if (nowTs - this.state.lastEmitAt < minInterval) return null;

      // If we got here, we’re in a dominant state and can emit
      const side = this.state.dominantSide;
      if (!side) return null;

      const strength = side === "ASK" ? s.buyRatio : s.sellRatio;

      this.state.lastEmitAt = nowTs;

      if (this.config.cooldownMs > 0) {
        this.state.cooldownUntil = nowTs + this.config.cooldownMs;
      }

      const event = {
        type: "flow",
        timestamp: nowTs,
        side,
        strength,                 // 0..1
        tradesPerSec: s.tradesPerSec,
        volPerSec: s.volPerSec,
        windowMs: this.config.windowMs,
        buyVol: s.buyVol,
        sellVol: s.sellVol,
        buyCount: s.buyCount,
        sellCount: s.sellCount
      };

      if (this.config.debug) {
        // eslint-disable-next-line no-console
        console.log("[EventEngine] emit", event);
      }

      return event;
    }

    _enterOrContinue(side, nowTs) {
      if (this.state.dominantSide !== side) {
        this.state.dominantSide = side;
        this.state.dominantSince = nowTs;

        if (this.config.lockSideMs > 0) {
          this.state.lockedUntil = nowTs + this.config.lockSideMs;
        }
      }
      // else continuing same dominance
    }

    _maybeExitDominance(nowTs, computed) {
      if (!this.state.dominantSide) return;

      // Exit dominance if it falls below exit threshold for the currently dominant side
      const ratio = this.state.dominantSide === "ASK" ? computed.buyRatio : computed.sellRatio;
      if (ratio < this.config.exitDominance) {
        this.state.dominantSide = null;
        this.state.dominantSince = null;
        this.state.lockedUntil = 0;
      }
    }

    // Optional: allow UI to display what the engine is "thinking"
    getState() {
      return {
        config: { ...this.config },
        dominantSide: this.state.dominantSide,
        dominantSince: this.state.dominantSince,
        lockedUntil: this.state.lockedUntil,
        lastEmitAt: this.state.lastEmitAt,
        cooldownUntil: this.state.cooldownUntil,
        lastComputed: this.lastComputed ? { ...this.lastComputed } : null,
        windowSize: this.window.length
      };
    }
  }

  window.EventEngine = EventEngine;
})();
