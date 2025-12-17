// File Tail Reader for Sierra Chart Tick Data
// Reads tick data exported by ACSIL study in real-time

const fs = require('fs');
const WebSocket = require('ws');

const CONFIG = {
    TICK_FILE: 'Z:\\TradeFlowData\\ticks.jsonl',  // Adjust path for your setup
    WS_PORT: 8080,
    POLL_INTERVAL_MS: 50  // Check file every 50ms
};

class TickFileReader {
    constructor() {
        this.wsServer = null;
        this.wsClients = new Set();
        this.filePosition = 0;
        this.lastSequence = 0;
        this.running = false;
        this.tickCount = 0;
        this.pollInterval = null;
    }
    
    // Start WebSocket server
    startWebSocketServer() {
        this.wsServer = new WebSocket.Server({ port: CONFIG.WS_PORT });
        
        this.wsServer.on('connection', (ws) => {
            console.log('✓ Electron app connected to WebSocket');
            this.wsClients.add(ws);
            
            ws.on('close', () => {
                console.log('✗ Electron app disconnected');
                this.wsClients.delete(ws);
            });
        });
        
        console.log(`✓ WebSocket server listening on port ${CONFIG.WS_PORT}`);
    }
    
    // Broadcast tick to clients
    broadcast(tick) {
        const message = JSON.stringify({
            type: 'trade',
            data: {
                timestamp: tick.ts,
                price: tick.p,
                volume: tick.v,
                side: tick.s,
                symbol: tick.sym
            }
        });
        
        this.wsClients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    }
    
    // Read new lines from file
    readNewLines() {
        try {
            const stats = fs.statSync(CONFIG.TICK_FILE);
            const fileSize = stats.size;
            
            // Log file size checks periodically
            if (this.tickCount % 50 === 0 || this.tickCount < 10) {
                console.log(`File check: size=${fileSize}, position=${this.filePosition}, new=${fileSize - this.filePosition} bytes`);
            }
            
            // If file was truncated/rotated, reset position
            if (fileSize < this.filePosition) {
                console.log('⚠️  File rotated, resetting position');
                this.filePosition = 0;
            }
            
            // If no new data, return
            if (fileSize === this.filePosition) {
                return;
            }
            
            console.log(`📖 Reading ${fileSize - this.filePosition} new bytes from position ${this.filePosition}`);
            
            // Read new data
            const buffer = Buffer.alloc(fileSize - this.filePosition);
            const fd = fs.openSync(CONFIG.TICK_FILE, 'r');
            fs.readSync(fd, buffer, 0, buffer.length, this.filePosition);
            fs.closeSync(fd);
            
            // Update position
            this.filePosition = fileSize;
            
            // Parse lines
            const newData = buffer.toString('utf8');
            const lines = newData.split('\n');
            
            console.log(`📝 Parsing ${lines.length} lines`);
            
            lines.forEach(line => {
                line = line.trim();
                if (!line) return;
                
                try {
                    const tick = JSON.parse(line);
                    
                    // Log first few ticks in detail
                    if (this.tickCount < 5) {
                        console.log(`✓ Tick ${this.tickCount + 1}:`, JSON.stringify(tick));
                    }
                    
                    // Check sequence to detect missed ticks
                    if (this.lastSequence > 0 && tick.seq !== this.lastSequence + 1) {
                        const missed = tick.seq - this.lastSequence - 1;
                        console.log(`⚠️  Missed ${missed} ticks (seq gap: ${this.lastSequence} → ${tick.seq})`);
                    }
                    
                    this.lastSequence = tick.seq;
                    this.tickCount++;
                    
                    // Broadcast to clients
                    this.broadcast(tick);
                    
                    // Log periodically
                    if (this.tickCount % 100 === 0) {
                        console.log(`📊 Processed ${this.tickCount} ticks (seq: ${tick.seq}) - Last: ${tick.s} ${tick.v} @ ${tick.p}`);
                    }
                    
                } catch (err) {
                    console.error('❌ Failed to parse tick:', line);
                }
            });
            
        } catch (err) {
            if (err.code !== 'ENOENT') {
                console.error('❌ Error reading file:', err.message);
            }
            // File doesn't exist yet - that's ok, waiting for ACSIL to create it
        }
    }
    
    // Start reading
    start() {
        console.log('='.repeat(60));
        console.log('SIERRA CHART TICK READER (File-based)');
        console.log('Tick File:', CONFIG.TICK_FILE);
        console.log('Poll Interval:', CONFIG.POLL_INTERVAL_MS + 'ms');
        console.log('='.repeat(60) + '\n');
        
        this.running = true;
        this.startWebSocketServer();
        
        // Check if file exists
        if (fs.existsSync(CONFIG.TICK_FILE)) {
            const stats = fs.statSync(CONFIG.TICK_FILE);
            console.log(`✓ Tick file found (${stats.size} bytes)`);
            
            // Start from end of file (only read new ticks)
            this.filePosition = stats.size;
        } else {
            console.log('⚠️  Tick file not found yet');
            console.log('   Waiting for ACSIL study to create it...\n');
        }
        
        // Start polling
        this.pollInterval = setInterval(() => {
            this.readNewLines();
        }, CONFIG.POLL_INTERVAL_MS);
        
        console.log('✓ Started reading ticks\n');
    }
    
    stop() {
        this.running = false;
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
        }
        if (this.wsServer) {
            this.wsServer.close();
        }
    }
}

// Start
console.log('TradeFlow Tick Reader (File-based)');
console.log('===================================\n');

const reader = new TickFileReader();
reader.start();

// Handle Ctrl+C
process.on('SIGINT', () => {
    console.log('\n\nShutting down...');
    reader.stop();
    process.exit(0);
});