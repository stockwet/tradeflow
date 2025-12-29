# TradeFlow Audio Monitor

TradeFlow Audio Monitor is a real-time **order flow audio analysis tool** designed to help futures traders hear market behavior instead of visually monitoring charts.

Rather than replaying trades one-for-one, TradeFlow translates Time & Sales data into structured, side-aware audio that communicates **pace, pressure, dominance, and regime change** in real time.

Audio is the primary interface. Visuals exist only to confirm what you’re hearing.

---

## Core Concepts

* **Stereo audio**

  * Left ear = SELL / BID
  * Right ear = BUY / ASK
* **Multiple listening modes**

  * Each mode answers a different market question
* **Adaptive baselines**

  * No fixed thresholds
  * Signals scale to market conditions
* **Sparse > noisy**

  * Fewer, higher-information audio events

TradeFlow is meant to feel more like listening to an instrument than watching a dashboard.

---

## Features

* Stereo audio engine with side awareness
* Professional-style stereo VU meter
* Center-zero imbalance meter (volume/sec)
* Live WebSocket data ingestion (Sierra Chart)
* CSV playback for testing and replay
* Multiple audio engines (mode-based)
* Adaptive velocity-based audio
* Rolling real-time statistics
* Persistent settings drawer

---

## Audio Modes

### 1. Raw Mode (Every Trade)

**Purpose:** Direct tape awareness

* One sound per qualifying trade
* True per-tick audio
* Loudness scales with actual trade volume
* Natural “machine gun” effect during fast markets

Best for:

* Tape reading
* Debugging
* Feeling true tick flow

---

### 2. Intelligent Mode (Dominance-Based)

**Purpose:** Hear sustained pressure

* Uses a rolling time window
* Detects dominance by:

  * Volume **or**
  * Trade count
* Entry / exit thresholds
* Side locking and cooldowns
* Filters noise and short-lived spikes

Result:

* Fewer, more meaningful alerts
* Pressure-focused listening

---

### 3. Transition Detection Mode

**Purpose:** Detect regime change

This mode is **event-based**, not continuous.

It identifies:

* Thrusts
* Pullbacks
* Absorption
* Failure / flips

Characteristics:

* Sparse audio
* High informational value
* Structure-aware, not intensity-aware

Used to hear:

* Breakouts vs failures
* Initiative shifts
* Structural changes

---

### 4. Velocity Pulse Mode

**Purpose:** Hear pace and pressure acceleration

Velocity Pulse produces a **continuous micro-click stream** driven by rolling statistics instead of individual trades.

Design:

* **Pace = trades/sec**
* **Loudness = volume/sec**
* Adaptive EMA baselines per side
* Only the strongest side plays at a time
* Built-in hysteresis prevents flip-flopping

Result:

* TickStrike-style “machine gun” feel
* Without replaying every trade
* Highly responsive with reduced noise

---

## Visual Components (Secondary)

Visuals confirm audio — they are not the decision driver.

### VU Meter

* Stereo-mapped (SELL left / BUY right)
* Mirrors the **same pseudo-volume** used by the active audio engine
* Sensitivity adjustable

### Imbalance Meter

* Center-zero volume/sec imbalance
* Green = buy dominance
* Red = sell dominance
* Continuous (no binning)

### Rolling Statistics

* Trades
* Volume
* Trades per second
* Volume per second
* Volume per trade

---

## Data Sources

### Live Mode (WebSocket)

* Connects to a local TradeFlow server
* Server receives Time & Sales from Sierra Chart (ACSIL)
* Automatic reconnect unless manually disconnected

### CSV Playback Mode

* Load historical Time & Sales CSV files
* Adjustable playback speed
* Useful for testing, tuning, and training

#### CSV Format

```csv
timestamp,price,volume,side
1703001600000,25293.25,10,BID
1703001600050,25293.50,15,ASK
```

---

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Start the Application

```bash
npm start
```

### 3. Choose Data Source

* **Live (WebSocket)** for Sierra Chart
* **CSV Playback** for testing and replay

---

## Settings System

All configuration lives in a **slide-out settings drawer**.

### Audio Settings

* Master volume
* Bid / Ask frequencies
* Meter sensitivity
* Optional order aggregation

### Mode-Specific Settings

Each audio mode exposes only its relevant controls:

* Intelligent mode thresholds
* Transition detection parameters
* Velocity Pulse tuning

### Persistence

* All settings stored in `localStorage`
* Separate configuration per audio mode
* Reset-to-defaults available

---

## Architecture Overview

```text
Sierra Chart (ACSIL Study)
        ↓
Node.js Server (TCP)
        ↓
WebSocket
        ↓
Electron Client
        ↓
Audio Engines + Visual Confirmation
```

* Single WebSocket connection
* Symbol handling client-side
* No per-symbol ports

---

## Design Philosophy

TradeFlow is not an alert system.

It is a **sensory interface** for understanding order flow behavior.

The goal is not to tell you *what to do*, but to help you:

* Feel pressure building
* Notice initiative shifts
* Recognize absorption vs continuation
* Stay aware without staring at a screen

---

## Current State

* End-to-end pipeline working
* Live and CSV replay supported
* Four distinct audio paradigms implemented
* Adaptive rolling statistics
* Velocity-based machine-gun audio
* Fully functional settings system
* Visual meters aligned with audio output

This repository reflects the **current functional state** of TradeFlow, not a future roadmap.

---

## License

Private / Proprietary

All rights reserved.
