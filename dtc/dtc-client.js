// DTC Client for Sierra Chart
// Connects to Sierra Chart's DTC server and streams Time & Sales data

const net = require('net');
const WebSocket = require('ws');

// Configuration
const CONFIG = {
    // Sierra Chart DTC Server
    SC_HOST: '10.211.55.5',  // Your Parallels Windows IP
    SC_PORT: 11099,           // Default DTC port
    
    // Symbol to subscribe to
    SYMBOL: 'NQH6',           // NQ March 2026
    EXCHANGE: 'CME',
    
    // WebSocket server (for sending data to Electron app)
    WS_PORT: 8080,
    
    // DTC Protocol - Sierra Chart will use JSON Compact automatically
    ENCODING: 'JSON_COMPACT'
};

// DTC Message Types (Binary Encoding)
const DTC_MESSAGE_TYPES = {
    LOGON_REQUEST: 1,
    LOGON_RESPONSE: 2,
    HEARTBEAT: 3,
    MARKET_DATA_REQUEST: 101,
    MARKET_DATA_REJECT: 103,
    MARKET_DATA_SNAPSHOT: 104,
    MARKET_DATA_UPDATE_SESSION_OPEN: 105,
    MARKET_DATA_UPDATE_SESSION_HIGH: 106,
    MARKET_DATA_UPDATE_TRADE: 107,
    MARKET_DATA_UPDATE_TRADE_COMPACT: 112,
    MARKET_DATA_UPDATE_LAST_TRADE_SNAPSHOT: 134,
    MARKET_DATA_UPDATE_BID_ASK: 108,
    MARKET_DATA_UPDATE_BID_ASK_COMPACT: 117,
};

class DTCClient {
    constructor() {
        this.socket = null;
        this.wsServer = null;
        this.wsClients = new Set();
        this.connected = false;
        this.loggedIn = false;
        this.messageBuffer = Buffer.alloc(0);
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
    
    // Broadcast data to all connected Electron clients
    broadcast(data) {
        const message = JSON.stringify(data);
        this.wsClients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    }
    
    // Connect to Sierra Chart DTC server
    connect() {
        console.log(`Connecting to Sierra Chart at ${CONFIG.SC_HOST}:${CONFIG.SC_PORT}...`);
        
        this.socket = net.createConnection({
            host: CONFIG.SC_HOST,
            port: CONFIG.SC_PORT
        });
        
        this.socket.on('connect', () => {
            console.log('✓ Connected to Sierra Chart DTC server');
            this.connected = true;
            this.messageBuffer = Buffer.alloc(0); // Clear buffer on new connection
            this.sendLogonRequest();
        });
        
        this.socket.on('data', (data) => {
            console.log('📥 Received', data.length, 'bytes');
            this.handleData(data);
        });
        
        this.socket.on('error', (err) => {
            console.error('✗ Connection error:', err.message);
            console.log('\nTroubleshooting:');
            console.log('1. Is Sierra Chart running?');
            console.log('2. Is DTC Protocol Server enabled in Global Settings?');
            console.log('3. Is "Allow Remote Connections" checked?');
            console.log('4. Is the IP address correct?', CONFIG.SC_HOST);
            console.log('5. Windows Firewall: Allow port', CONFIG.SC_PORT);
        });
        
        this.socket.on('close', () => {
            console.log('✗ Disconnected from Sierra Chart');
            console.log('   Last state: connected=' + this.connected + ', loggedIn=' + this.loggedIn);
            this.connected = false;
            this.loggedIn = false;
            
            // Reconnect after 5 seconds
            setTimeout(() => {
                console.log('Attempting to reconnect...');
                this.connect();
            }, 5000);
        });
    }
    
    // Send a JSON message with null terminator (JSON Compact format)
    sendJsonMessage(obj) {
        const jsonStr = JSON.stringify(obj);
        const payload = Buffer.concat([
            Buffer.from(jsonStr, 'utf8'),
            Buffer.from([0])  // Null terminator
        ]);
        this.socket.write(payload);
        return jsonStr;
    }
    
    // Send logon request
    sendLogonRequest() {
        console.log('Sending logon request...');
        
        // DTC Logon Request - minimal required fields
        const logonRequest = {
            Type: DTC_MESSAGE_TYPES.LOGON_REQUEST,
            ProtocolVersion: 8,
            Username: '',
            Password: '',
            HeartbeatIntervalInSeconds: 30,
            ClientName: 'TradeFlow'
            // Note: Don't use Integer_1 to request encoding - set it in SC settings instead
        };
        
        const jsonStr = this.sendJsonMessage(logonRequest);
        console.log('Logon request sent:', logonRequest);
        console.log('Raw JSON:', jsonStr);
    }
    
    // Subscribe to market data for a symbol
    subscribeToMarketData() {
        if (!this.loggedIn) {
            console.log('✗ Cannot subscribe - not logged in yet');
            return;
        }
        
        console.log(`Subscribing to market data for ${CONFIG.SYMBOL}...`);
        
        const request = {
            Type: DTC_MESSAGE_TYPES.MARKET_DATA_REQUEST,
            RequestAction: 1,  // Subscribe
            SymbolID: 1,
            Symbol: CONFIG.SYMBOL,
            Exchange: CONFIG.EXCHANGE
        };
        
        this.sendJsonMessage(request);
        console.log('✓ Market data subscription sent');
    }
    
    // Handle incoming data from Sierra Chart
    handleData(chunk) {
        // Append new data to buffer
        this.messageBuffer = Buffer.concat([this.messageBuffer, chunk]);
        
        console.log('📥 Received', chunk.length, 'bytes, buffer now has', this.messageBuffer.length, 'bytes');
        
        // Split on null terminator (0x00)
        let idx;
        while ((idx = this.messageBuffer.indexOf(0)) !== -1) {
            // Extract message up to null byte
            const msgBuf = this.messageBuffer.slice(0, idx);
            
            // Remove processed message + null byte from buffer
            this.messageBuffer = this.messageBuffer.slice(idx + 1);
            
            // Convert to string and parse
            const jsonStr = msgBuf.toString('utf8').trim();
            if (!jsonStr) continue;
            
            console.log('📨 Parsing message:', jsonStr.substring(0, 100) + (jsonStr.length > 100 ? '...' : ''));
            
            try {
                const message = JSON.parse(jsonStr);
                this.processMessage(message);
            } catch (err) {
                console.error('Failed to parse JSON:', err.message);
                console.error('Raw JSON:', jsonStr);
            }
        }
    }
    
    // Process DTC message
    processMessage(message) {
        // Don't log heartbeats to reduce spam
        if (message.Type !== DTC_MESSAGE_TYPES.HEARTBEAT) {
            console.log('📨 Received message type', message.Type + ':', JSON.stringify(message).substring(0, 150));
        }
        
        switch (message.Type) {
            case DTC_MESSAGE_TYPES.LOGON_RESPONSE:
                this.handleLogonResponse(message);
                break;
                
            case DTC_MESSAGE_TYPES.HEARTBEAT:
                // Heartbeat - no need to log
                this.sendHeartbeat();
                break;
                
            case DTC_MESSAGE_TYPES.MARKET_DATA_UPDATE_TRADE:
                this.handleTradeUpdate(message);
                break;
                
            case DTC_MESSAGE_TYPES.MARKET_DATA_UPDATE_TRADE_COMPACT:
                this.handleTradeUpdateCompact(message);
                break;
                
            case DTC_MESSAGE_TYPES.MARKET_DATA_UPDATE_LAST_TRADE_SNAPSHOT:
                this.handleLastTradeSnapshot(message);
                break;
                
            case DTC_MESSAGE_TYPES.MARKET_DATA_UPDATE_BID_ASK:
                this.handleBidAskUpdate(message);
                break;
                
            case DTC_MESSAGE_TYPES.MARKET_DATA_UPDATE_BID_ASK_COMPACT:
                this.handleBidAskUpdateCompact(message);
                break;
                
            case DTC_MESSAGE_TYPES.MARKET_DATA_SNAPSHOT:
                console.log('📸 Market data snapshot received');
                break;
                
            case DTC_MESSAGE_TYPES.MARKET_DATA_REJECT:
                console.error('❌ Market data rejected:', message.RejectText || 'Unknown reason');
                break;
                
            default:
                console.log('❓ Unknown message type:', message.Type);
                console.log('   Full message:', JSON.stringify(message));
        }
    }
    
    // Handle logon response
    handleLogonResponse(message) {
        console.log('🔐 Logon response:', JSON.stringify(message));
        
        if (message.Result === 1 || message.Result === undefined) {
            console.log('✓ Logged in successfully');
            this.loggedIn = true;
            
            // Subscribe to market data
            setTimeout(() => {
                this.subscribeToMarketData();
            }, 100);
        } else {
            console.error('✗ Logon failed:', message.ResultText || 'Unknown error');
            console.error('Full response:', JSON.stringify(message));
        }
    }
    
    // Send heartbeat
    sendHeartbeat() {
        const heartbeat = {
            Type: DTC_MESSAGE_TYPES.HEARTBEAT
        };
        this.sendJsonMessage(heartbeat);
    }
    
    // Handle trade update (Type 107)
    handleTradeUpdate(message) {
        const trade = {
            timestamp: Date.now(),
            price: message.Price,
            volume: message.Volume,
            side: message.AtBidOrAsk === 1 ? 'BID' : 'ASK',
            symbol: CONFIG.SYMBOL
        };
        
        console.log(`📊 Trade: ${trade.side} ${trade.volume} @ ${trade.price}`);
        
        // Broadcast to Electron app
        this.broadcast({
            type: 'trade',
            data: trade
        });
    }
    
    // Handle compact trade update (Type 112) - uses F array
    handleTradeUpdateCompact(message) {
        // Compact format: F array contains [SymbolID, AtBidOrAsk, Price, Volume, DateTime]
        const F = message.F || [];
        
        const trade = {
            timestamp: Date.now(),
            price: F[2] || 0,
            volume: F[3] || 0,
            side: F[1] === 1 ? 'BID' : 'ASK',
            symbol: CONFIG.SYMBOL
        };
        
        console.log(`📊 Trade (compact): ${trade.side} ${trade.volume} @ ${trade.price}`);
        
        // Broadcast to Electron app
        this.broadcast({
            type: 'trade',
            data: trade
        });
    }
    
    // Handle last trade snapshot (Type 134)
    handleLastTradeSnapshot(message) {
        const trade = {
            timestamp: Date.now(),
            price: message.Price || 0,
            volume: message.Volume || 0,
            side: message.AtBidOrAsk === 1 ? 'BID' : 'ASK',
            symbol: CONFIG.SYMBOL
        };
        
        console.log(`📊 Last Trade: ${trade.side} ${trade.volume} @ ${trade.price}`);
        
        // Broadcast to Electron app
        this.broadcast({
            type: 'trade',
            data: trade
        });
    }
    
    // Handle bid/ask update (Type 108)
    handleBidAskUpdate(message) {
        console.log(`📈 Bid/Ask: ${message.BidPrice} / ${message.AskPrice}`);
        
        // You could use this to infer trade direction
        // Store for comparison with next trade
    }
    
    // Handle compact bid/ask update (Type 117)
    handleBidAskUpdateCompact(message) {
        const F = message.F || [];
        console.log(`📈 Bid/Ask (compact): ${F[2]} / ${F[3]}`);
    }
    
    // Disconnect
    disconnect() {
        if (this.socket) {
            this.socket.end();
        }
        if (this.wsServer) {
            this.wsServer.close();
        }
    }
}

// Main
console.log('TradeFlow DTC Client');
console.log('===================\n');

// Start client
const client = new DTCClient();
client.startWebSocketServer();
client.connect();

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down...');
    client.disconnect();
    process.exit(0);
});