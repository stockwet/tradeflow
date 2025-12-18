// tradeflow-logger.js
// Continuous tick logger for Sierra Chart ACSIL -> TCP newline-delimited JSON
// Logs until you stop the process (Ctrl+C).
//
// Output folder: C:\TradeFlowData
// Output format: JSONL (one JSON object per line), optional CSV
//
// Run: node tradeflow-logger.js

const net = require('net');
const fs = require('fs');
const path = require('path');

const CONFIG = {
  TCP_PORT: 9999,
  HOST: '127.0.0.1',

  OUTPUT_DIR: 'C:\\TradeFlowData',
  WRITE_CSV: false, // set true if you also want a CSV alongside JSONL

  FLUSH_EVERY_LINES: 500,   // fsync every N lines for safety (0 = never)
  STATS_EVERY_MS: 5000      // console stats interval
};

function safeMkdir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function timestampForFilename(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    '_' +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

class TradeFlowLogger {
  constructor() {
    this.tcpServer = null;
    this.buffer = '';

    this.tickCount = 0;
    this.lastSeqBySymbol = new Map();
    this.gapCount = 0;

    this.jsonlStream = null;
    this.csvStream = null;
    this.linesSinceFlush = 0;

    this.startTime = Date.now();
    this.currentFileBase = null;
  }

  openStreams() {
    safeMkdir(CONFIG.OUTPUT_DIR);

    const base = `tradeflow_${timestampForFilename()}`;
    this.currentFileBase = base;

    const jsonlPath = path.join(CONFIG.OUTPUT_DIR, `${base}.jsonl`);
    this.jsonlStream = fs.createWriteStream(jsonlPath, { flags: 'a' });

    if (CONFIG.WRITE_CSV) {
      const csvPath = path.join(CONFIG.OUTPUT_DIR, `${base}.csv`);
      const isNew = !fs.existsSync(csvPath);
      this.csvStream = fs.createWriteStream(csvPath, { flags: 'a' });
      if (isNew) this.csvStream.write('seq,ts,price,volume,side,symbol\n');
    }

    console.log(`✓ Logging to: ${jsonlPath}`);
    if (CONFIG.WRITE_CSV) console.log(`✓ CSV also enabled: ${path.join(CONFIG.OUTPUT_DIR, `${base}.csv`)}`);
  }

  start() {
    this.openStreams();

    this.tcpServer = net.createServer((socket) => {
      console.log(`✓ Sierra Chart connected from ${socket.remoteAddress}`);

      socket.on('data', (data) => this.handleData(data));
      socket.on('end', () => console.log('✗ Sierra Chart disconnected'));
      socket.on('error', (err) => console.error('Socket error:', err.message));
    });

    this.tcpServer.listen(CONFIG.TCP_PORT, CONFIG.HOST, () => {
      console.log('============================================================');
      console.log('TRADEFLOW LOGGER (TCP)');
      console.log(`TCP: ${CONFIG.HOST}:${CONFIG.TCP_PORT}`);
      console.log(`Output Dir: ${CONFIG.OUTPUT_DIR}`);
      console.log('Format: JSONL (one tick per line)');
      console.log('============================================================\n');
      console.log('Waiting for Sierra Chart ACSIL study to connect...\n');
    });

    this.statsTimer = setInterval(() => this.printStats(), CONFIG.STATS_EVERY_MS);
  }

  handleData(data) {
    this.buffer += data.toString('utf8');

    let newlineIndex;
    while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.substring(0, newlineIndex).trim();
      this.buffer = this.buffer.substring(newlineIndex + 1);

      if (!line) continue;

      let tick;
      try {
        tick = JSON.parse(line);
      } catch {
        // If a partial/garbled line gets through, just skip it.
        continue;
      }

      this.processTick(tick);
    }
  }

  processTick(tick) {
    // Expecting: { seq, ts, p, v, s, sym }
    const sym = tick.sym || 'UNKNOWN';
    const seq = Number(tick.seq);

    // Basic sequence gap tracking per symbol
    const last = this.lastSeqBySymbol.get(sym);
    if (Number.isFinite(seq) && Number.isFinite(last) && seq !== last + 1) {
      const missed = seq - last - 1;
      if (missed > 0) this.gapCount += missed;
    }
    if (Number.isFinite(seq)) this.lastSeqBySymbol.set(sym, seq);

    // Write JSONL (fast, append-only)
    this.jsonlStream.write(JSON.stringify(tick) + '\n');
    this.linesSinceFlush++;

    // Optional CSV
    if (this.csvStream) {
      const row = `${tick.seq ?? ''},${tick.ts ?? ''},${tick.p ?? ''},${tick.v ?? ''},${tick.s ?? ''},${tick.sym ?? ''}\n`;
      this.csvStream.write(row);
    }

    // Optional periodic fsync for safety
    if (CONFIG.FLUSH_EVERY_LINES > 0 && this.linesSinceFlush >= CONFIG.FLUSH_EVERY_LINES) {
      this.linesSinceFlush = 0;
      try {
        if (this.jsonlStream.fd) fs.fsyncSync(this.jsonlStream.fd);
        if (this.csvStream?.fd) fs.fsyncSync(this.csvStream.fd);
      } catch {
        // ignore fsync errors
      }
    }

    this.tickCount++;
  }

  printStats() {
    const elapsedSec = (Date.now() - this.startTime) / 1000;
    const tps = elapsedSec > 0 ? this.tickCount / elapsedSec : 0;

    // show a few symbols
    const symbols = Array.from(this.lastSeqBySymbol.keys()).slice(0, 5);
    const symText = symbols.length ? symbols.join(', ') : '(none yet)';

    console.log(
      `📊 ticks=${this.tickCount}  tps=${tps.toFixed(1)}  gaps=${this.gapCount}  symbols=${symText}`
    );
  }

  stop() {
    console.log('\nShutting down logger...');
    clearInterval(this.statsTimer);

    if (this.tcpServer) this.tcpServer.close();

    const closeStream = (s) =>
      new Promise((resolve) => {
        if (!s) return resolve();
        s.end(() => resolve());
      });

    return Promise.all([closeStream(this.jsonlStream), closeStream(this.csvStream)]).then(() => {
      console.log(`✓ Closed log file: ${this.currentFileBase}`);
    });
  }
}

const logger = new TradeFlowLogger();
logger.start();

process.on('SIGINT', async () => {
  await logger.stop();
  process.exit(0);
});
