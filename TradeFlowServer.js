// TCP Socket Reader for Sierra Chart Tick Data
// Receives tick data from ACSIL study over TCP socket

const net = require('net');
const WebSocket = require('ws');
const fs = require('fs');

const CONFIG = {
    TCP_PORT: 9999,
    WS_PORT: 8080
};

const RECORDING_CONFIG = {
    ENABLED: false,  // Set to true to record
    MAX_TRADES: 1000, // Stop after this many
    FILENAME: 'tradeflow_sample.csv'
};

class SocketTickReader {
    constructor() {
        this.wsServer = null;
        this.wsClients = new Set();
        this.tcpServer = null;
        this.sierraChartSocket = null;
        this.tickCount = 0;
        this.lastSequence = 0;
        this.buffer = '';
        this.recordedTrades = [];
    }
    
    // Start WebSocket server for Electron app
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
    
    // Broadcast tick to Electron clients
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
    
    // Start TCP server to receive from Sierra Chart
    startTCPServer() {
        this.tcpServer = net.createServer((socket) => {
            console.log('✓ Sierra Chart connected from', socket.remoteAddress);
            
            this.sierraChartSocket = socket;
            
            socket.on('data', (data) => {
                this.handleData(data);
            });
            
            socket.on('end', () => {
                console.log('✗ Sierra Chart disconnected');
                this.sierraChartSocket = null;
            });
            
            socket.on('error', (err) => {
                console.error('Socket error:', err.message);
            });
        });
        
        this.tcpServer.listen(CONFIG.TCP_PORT, '127.0.0.1', () => {
            console.log(`✓ TCP server listening on port ${CONFIG.TCP_PORT}`);
            console.log('  Waiting for Sierra Chart ACSIL study to connect...\n');
        });
    }
    
    // Handle incoming data
    handleData(data) {
        // Append to buffer
        this.buffer += data.toString('utf8');
        
        // Process complete lines
        let newlineIndex;
        while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
            const line = this.buffer.substring(0, newlineIndex).trim();
            this.buffer = this.buffer.substring(newlineIndex + 1);
            
            if (!line) continue;
            
            try {
                const tick = JSON.parse(line);
                
                // Log first 10 ticks with full structure
                if (this.tickCount < 10) {
                    console.log(`\n✓ Tick ${this.tickCount + 1} (full data):`);
                    console.log(JSON.stringify(tick, null, 2));
                }
                
                // Record to CSV if enabled
                if (RECORDING_CONFIG.ENABLED && this.recordedTrades.length < RECORDING_CONFIG.MAX_TRADES) {
                    this.recordedTrades.push(tick);
                    if (this.recordedTrades.length === RECORDING_CONFIG.MAX_TRADES) {
                        this.saveRecording();
                    }
                }
                
                // Check sequence
                if (this.lastSequence > 0 && tick.seq !== this.lastSequence + 1) {
                    const missed = tick.seq - this.lastSequence - 1;
                    console.log(`⚠️  Missed ${missed} ticks (seq gap: ${this.lastSequence} → ${tick.seq})`);
                }
                
                this.lastSequence = tick.seq;
                this.tickCount++;
                
                // Broadcast to Electron
                this.broadcast(tick);
                
                // Log periodically
                if (this.tickCount % 100 === 0) {
                    console.log(`📊 Processed ${this.tickCount} ticks (seq: ${tick.seq}) - ${tick.s} ${tick.v} @ ${tick.p}`);
                }
                
            } catch (err) {
                console.error('❌ Failed to parse:', line);
            }
        }
    }
    
    // Save recorded trades to CSV
    saveRecording() {
        const csv = 'seq,timestamp,price,volume,side,symbol\n' + 
            this.recordedTrades.map(t => 
                `${t.seq},${t.ts},${t.p},${t.v},${t.s},${t.sym}`
            ).join('\n');
        
        fs.writeFileSync(RECORDING_CONFIG.FILENAME, csv);
        console.log(`\n${'='.repeat(60)}`);
        console.log(`✓ RECORDING COMPLETE`);
        console.log(`  Saved ${this.recordedTrades.length} trades to ${RECORDING_CONFIG.FILENAME}`);
        console.log(`${'='.repeat(60)}\n`);
    }
    
    start() {
        console.log('='.repeat(60));
        console.log('SIERRA CHART TICK READER (TCP Socket)');
        console.log('TCP Port:', CONFIG.TCP_PORT);
        console.log('WebSocket Port:', CONFIG.WS_PORT);
        if (RECORDING_CONFIG.ENABLED) {
            console.log(`📹 RECORDING ENABLED (${RECORDING_CONFIG.MAX_TRADES} trades max)`);
        }
        console.log('='.repeat(60) + '\n');
        
        this.startWebSocketServer();
        this.startTCPServer();
    }
    
    stop() {
        // Save any partial recording
        if (RECORDING_CONFIG.ENABLED && this.recordedTrades.length > 0) {
            this.saveRecording();
        }
        
        if (this.sierraChartSocket) {
            this.sierraChartSocket.end();
        }
        if (this.tcpServer) {
            this.tcpServer.close();
        }
        if (this.wsServer) {
            this.wsServer.close();
        }
    }
}

// Start
console.log('TradeFlow Tick Reader (TCP Socket)');
console.log('===================================\n');

const reader = new SocketTickReader();
reader.start();

// Handle Ctrl+C
process.on('SIGINT', () => {
    console.log('\n\nShutting down...');
    reader.stop();
    process.exit(0);
});