// transition-detection-engine.js
// TradeFlow Transition Detection Engine
// Detects significant STATE CHANGES in order flow rather than continuous dominance.
// Designed to emit 10-20 meaningful events per 10 minutes instead of thousands.
// Exposes TransitionDetectionEngine as a global (window.TransitionDetectionEngine).

(function () {
  class TransitionDetectionEngine {
    constructor(config = {}) {
      this.config = {
        // Analysis window
        windowMs: 1000,                    // 1 second window for flow analysis
        maxWindowTrades: 500,              // safety cap

        // Thrust detection (directional acceleration)
        thrustThreshold: 0.6,              // 60%+ imbalance to qualify as thrust
        thrustChange: 0.3,                 // imbalance must CHANGE by 30% to trigger
        thrustMinVelocity: 20,             // minimum trades/sec for thrust

        // Pullback detection
        pullbackThreshold: 0.3,            // 30%+ counter-flow = pullback
        pullbackFade: 0.2,                 // fades to < 20% = exhaustion
        pullbackMinDuration: 1000,         // pullback must last at least 1 sec

        // Absorption detection
        absorptionThreshold: 0.2,          // within ±20% = balanced
        absorptionMinVelocity: 20,         // must have activity
        absorptionMinTrades: 15,           // minimum trades in window

        // State tracking
        historyDepth: 3,                   // remember last 3 imbalance values (3 seconds)
        
        // Event pacing
        minEventInterval: 500,             // min 500ms between events (prevents spam)
        
        // What metric to use
        dominanceMetric: "volume",         // "volume" | "count"

        // Debug
        debug: false,

        ...config
      };

      this.reset();
    }

    reset() {
      this.window = [];
      this.imbalanceHistory = [];          // Array of {timestamp, imbalance, velocity}
      this.state = {
        current: "NEUTRAL",                // NEUTRAL | THRUST_UP | THRUST_DOWN | PULLBACK_UP | PULLBACK_DOWN
        entered: null,                     // timestamp when entered current state
        lastEventAt: 0,                    // last event emission time
        thrustDirection: null,             // "UP" | "DOWN" | null (tracks trend direction)
      };
      this.lastComputed = null;
    }

    updateConfig(partial) {
      this.config = { ...this.config, ...partial };
    }

    normalizeTrade(trade) {
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

      // Prune history older than historyDepth seconds
      const historyCutoff = nowTs - (this.config.historyDepth * 1000);
      while (this.imbalanceHistory.length && this.imbalanceHistory[0].timestamp < historyCutoff) {
        this.imbalanceHistory.shift();
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

      // Imbalance: -1 (all sells) to +1 (all buys)
      const denom = this.config.dominanceMetric === "count" ? totalCount : totalVol;
      const buyMetric = this.config.dominanceMetric === "count" ? buyCount : buyVol;
      const sellMetric = this.config.dominanceMetric === "count" ? sellCount : sellVol;

      const imbalance = denom > 0 ? (buyMetric - sellMetric) / denom : 0;

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
        imbalance  // -1 to +1
      };

      this.lastComputed = computed;
      return computed;
    }

    updateHistory(nowTs, imbalance, velocity) {
      // Add current measurement to history
      this.imbalanceHistory.push({
        timestamp: nowTs,
        imbalance,
        velocity
      });

      // Keep only historyDepth seconds
      const cutoff = nowTs - (this.config.historyDepth * 1000);
      while (this.imbalanceHistory.length && this.imbalanceHistory[0].timestamp < cutoff) {
        this.imbalanceHistory.shift();
      }
    }

    getPreviousImbalance() {
      // Get imbalance from ~1 second ago
      if (this.imbalanceHistory.length < 2) return null;
      
      const now = this.imbalanceHistory[this.imbalanceHistory.length - 1].timestamp;
      const target = now - 1000; // 1 second ago
      
      // Find closest measurement to 1 second ago
      let closest = this.imbalanceHistory[0];
      let minDiff = Math.abs(closest.timestamp - target);
      
      for (const hist of this.imbalanceHistory) {
        const diff = Math.abs(hist.timestamp - target);
        if (diff < minDiff) {
          minDiff = diff;
          closest = hist;
        }
      }
      
      return closest.imbalance;
    }

    detectTransition(stats) {
      const currentImb = stats.imbalance;
      const previousImb = this.getPreviousImbalance();
      
      if (previousImb === null) return null;
      
      const imbChange = currentImb - previousImb;
      const absCurrentImb = Math.abs(currentImb);
      const absChange = Math.abs(imbChange);
      
      // THRUST DETECTION: Strong one-sided flow that CHANGED significantly
      const isThrustDown = (
        currentImb < -this.config.thrustThreshold &&
        imbChange < -this.config.thrustChange &&
        stats.tradesPerSec >= this.config.thrustMinVelocity
      );
      
      const isThrustUp = (
        currentImb > this.config.thrustThreshold &&
        imbChange > this.config.thrustChange &&
        stats.tradesPerSec >= this.config.thrustMinVelocity
      );
      
      // PULLBACK EXHAUSTION: Counter-flow fading back to balanced/trend
      const wasPullbackUp = (
        previousImb > this.config.pullbackThreshold &&
        this.state.thrustDirection === "DOWN"
      );
      
      const wasPullbackDown = (
        previousImb < -this.config.pullbackThreshold &&
        this.state.thrustDirection === "UP"
      );
      
      const isPullbackExhausted = (
        absCurrentImb < this.config.pullbackFade &&
        absChange > this.config.pullbackFade &&
        (wasPullbackUp || wasPullbackDown)
      );
      
      // ABSORPTION: High activity, balanced flow
      const isAbsorption = (
        absCurrentImb < this.config.absorptionThreshold &&
        stats.tradesPerSec >= this.config.absorptionMinVelocity &&
        stats.totalCount >= this.config.absorptionMinTrades &&
        this.state.current === "NEUTRAL"
      );
      
      // Return detected transition
      if (isThrustDown) {
        return {
          type: "THRUST_DOWN",
          imbalance: currentImb,
          change: imbChange,
          velocity: stats.tradesPerSec
        };
      }
      
      if (isThrustUp) {
        return {
          type: "THRUST_UP",
          imbalance: currentImb,
          change: imbChange,
          velocity: stats.tradesPerSec
        };
      }
      
      if (isPullbackExhausted) {
        return {
          type: "PULLBACK_EXHAUSTION",
          trendDirection: this.state.thrustDirection,
          imbalance: currentImb,
          change: imbChange
        };
      }
      
      if (isAbsorption) {
        return {
          type: "ABSORPTION",
          imbalance: currentImb,
          velocity: stats.tradesPerSec,
          totalVol: stats.totalVol
        };
      }
      
      return null;
    }

    updateState(transition, nowTs) {
      if (!transition) return;
      
      switch (transition.type) {
        case "THRUST_UP":
          this.state.current = "THRUST_UP";
          this.state.thrustDirection = "UP";
          this.state.entered = nowTs;
          break;
          
        case "THRUST_DOWN":
          this.state.current = "THRUST_DOWN";
          this.state.thrustDirection = "DOWN";
          this.state.entered = nowTs;
          break;
          
        case "PULLBACK_EXHAUSTION":
          // After pullback exhaustion, return to neutral (ready for continuation or reversal)
          this.state.current = "NEUTRAL";
          // Keep thrust direction for context
          break;
          
        case "ABSORPTION":
          this.state.current = "ABSORPTION";
          this.state.entered = nowTs;
          break;
      }
    }

    ingest(trade) {
      const t = this.normalizeTrade(trade);
      if (!t) return null;

      const nowTs = t.timestamp;

      this.window.push(t);
      this.prune(nowTs);

      const stats = this.compute(nowTs);

      // Update imbalance history every trade
      this.updateHistory(nowTs, stats.imbalance, stats.tradesPerSec);

      // Event pacing - don't spam
      if (nowTs - this.state.lastEventAt < this.config.minEventInterval) {
        return null;
      }

      // Detect if a transition occurred
      const transition = this.detectTransition(stats);
      
      if (!transition) return null;

      // Update state
      this.updateState(transition, nowTs);
      this.state.lastEventAt = nowTs;

      // Build event object
      const event = {
        type: "transition",
        transitionType: transition.type,
        timestamp: nowTs,
        imbalance: stats.imbalance,
        velocity: stats.tradesPerSec,
        volPerSec: stats.volPerSec,
        buyVol: stats.buyVol,
        sellVol: stats.sellVol,
        buyCount: stats.buyCount,
        sellCount: stats.sellCount,
        windowMs: this.config.windowMs,
        ...transition  // Include transition-specific data
      };

      if (this.config.debug) {
        // eslint-disable-next-line no-console
        console.log("[TransitionEngine]", event);
      }

      return event;
    }

    getState() {
      return {
        config: { ...this.config },
        currentState: this.state.current,
        thrustDirection: this.state.thrustDirection,
        stateEnteredAt: this.state.entered,
        lastEventAt: this.state.lastEventAt,
        imbalanceHistory: [...this.imbalanceHistory],
        lastComputed: this.lastComputed ? { ...this.lastComputed } : null,
        windowSize: this.window.length
      };
    }
  }

  window.TransitionDetectionEngine = TransitionDetectionEngine;
})();