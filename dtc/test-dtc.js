// Simple DTC Test Client - Just Logs Everything
const net = require('net');

const CONFIG = {
    SC_HOST: '127.0.0.1',
    SC_PORT: 11099,
    SYMBOL: 'NQH6',  // Full symbol as it appears in Sierra Chart
    EXCHANGE: 'CME'          // Leave blank when using full symbol format
};

class SimpleDTCClient {
    constructor() {
        this.socket = null;
        this.messageBuffer = Buffer.alloc(0);
        this.messageCount = 0;
    }
    
    connect() {
        console.log('='.repeat(60));
        console.log('SIMPLE DTC TEST CLIENT');
        console.log('Connecting to Sierra Chart at', CONFIG.SC_HOST + ':' + CONFIG.SC_PORT);
        console.log('Symbol:', CONFIG.SYMBOL);
        console.log('='.repeat(60));
        
        this.socket = net.createConnection({
            host: CONFIG.SC_HOST,
            port: CONFIG.SC_PORT
        });
        
        this.socket.on('connect', () => {
            console.log('\n✓ CONNECTED\n');
            this.sendLogon();
        });
        
        this.socket.on('data', (chunk) => {
            this.handleData(chunk);
        });
        
        this.socket.on('error', (err) => {
            console.error('ERROR:', err.message);
        });
        
        this.socket.on('close', () => {
            console.log('\nDISCONNECTED');
        });
    }
    
    sendJsonMessage(obj) {
        const jsonStr = JSON.stringify(obj);
        const payload = Buffer.concat([
            Buffer.from(jsonStr, 'utf8'),
            Buffer.from([0])  // Null terminator
        ]);
        this.socket.write(payload);
    }
    
    sendLogon() {
        console.log('Sending LOGON...');
        this.sendJsonMessage({
            Type: 1,
            ProtocolVersion: 8,
            Username: '',
            Password: '',
            HeartbeatIntervalInSeconds: 30,
            ClientName: 'TestClient'
        });
    }
    
    subscribeMarketData() {
        console.log('\n' + '='.repeat(60));
        console.log('SUBSCRIBING TO MARKET DATA');
        console.log('Symbol:', CONFIG.SYMBOL);
        console.log('Exchange:', CONFIG.EXCHANGE || '(none - using full symbol)');
        console.log('='.repeat(60) + '\n');
        
        const request = {
            Type: 101,
            RequestAction: 1,  // Subscribe
            SymbolID: 1,
            Symbol: CONFIG.SYMBOL,
            Exchange: CONFIG.EXCHANGE
        };
        
        console.log('Request:', JSON.stringify(request));
        this.sendJsonMessage(request);
    }
    
    handleData(chunk) {
        this.messageBuffer = Buffer.concat([this.messageBuffer, chunk]);
        
        // Parse null-terminated messages
        let idx;
        while ((idx = this.messageBuffer.indexOf(0)) !== -1) {
            const msgBuf = this.messageBuffer.slice(0, idx);
            this.messageBuffer = this.messageBuffer.slice(idx + 1);
            
            const jsonStr = msgBuf.toString('utf8').trim();
            if (!jsonStr) continue;
            
            try {
                const message = JSON.parse(jsonStr);
                this.processMessage(message);
            } catch (err) {
                console.error('PARSE ERROR:', err.message);
            }
        }
    }
    
    processMessage(msg) {
        this.messageCount++;
        
        const typeNames = {
            1: 'LOGON_REQUEST',
            2: 'LOGON_RESPONSE',
            3: 'HEARTBEAT',
            101: 'MARKET_DATA_REQUEST',
            103: 'MARKET_DATA_REJECT',
            104: 'MARKET_DATA_SNAPSHOT',
            105: 'SESSION_OPEN',
            106: 'SESSION_HIGH',
            107: 'TRADE_UPDATE',
            108: 'BID_ASK_UPDATE',
            112: 'TRADE_COMPACT',
            117: 'BID_ASK_COMPACT',
            134: 'LAST_TRADE_SNAPSHOT'
        };
        
        const typeName = typeNames[msg.Type] || 'UNKNOWN';
        
        // Special handling for specific types
        if (msg.Type === 2) {
            // Logon response
            console.log('=' .repeat(60));
            console.log('LOGON RESPONSE');
            console.log('Result:', msg.Result === 1 ? 'SUCCESS' : 'FAILED');
            console.log('Server:', msg.ServerName);
            console.log('Market Data Supported:', msg.MarketDataSupported === 1 ? 'YES' : 'NO');
            console.log('=' .repeat(60));
            
            // Subscribe to market data
            setTimeout(() => this.subscribeMarketData(), 100);
            
        } else if (msg.Type === 3) {
            // Heartbeat - just show a dot
            process.stdout.write('.');
            
        } else if (msg.Type === 103) {
            // Market data reject
            console.log('\n' + '!'.repeat(60));
            console.log('MARKET DATA REJECTED');
            console.log('Reason:', msg.RejectText);
            console.log('!'.repeat(60));
            
        } else if (msg.Type === 104) {
            // Snapshot
            console.log('\n' + '-'.repeat(60));
            console.log('MARKET DATA SNAPSHOT (#' + this.messageCount + ')');
            console.log('Raw:', JSON.stringify(msg));
            console.log('-'.repeat(60));
            
        } else if (msg.Type === 107 || msg.Type === 112 || msg.Type === 134) {
            // TRADE UPDATE - THIS IS WHAT WE WANT!
            console.log('\n' + '*'.repeat(60));
            console.log('*** TRADE UPDATE *** (#' + this.messageCount + ')');
            console.log('Type:', typeName, '(' + msg.Type + ')');
            console.log('Raw:', JSON.stringify(msg));
            
            // Try to parse trade info
            if (msg.Price) {
                console.log('Price:', msg.Price);
                console.log('Volume:', msg.Volume);
                console.log('Side:', msg.AtBidOrAsk === 1 ? 'BID' : 'ASK');
            } else if (msg.F) {
                console.log('F array:', msg.F);
            }
            console.log('*'.repeat(60));
            
        } else if (msg.Type === 108 || msg.Type === 117) {
            // Bid/Ask update
            console.log('\n' + '-'.repeat(60));
            console.log('BID/ASK UPDATE (#' + this.messageCount + ')');
            console.log('Type:', typeName, '(' + msg.Type + ')');
            if (msg.BidPrice) {
                console.log('Bid:', msg.BidPrice, '@ size', msg.BidQuantity);
                console.log('Ask:', msg.AskPrice, '@ size', msg.AskQuantity);
            } else if (msg.F) {
                console.log('F array:', msg.F);
            }
            console.log('-'.repeat(60));
            
        } else {
            // Unknown type
            console.log('\n' + '?'.repeat(60));
            console.log('UNKNOWN MESSAGE TYPE:', msg.Type, '(#' + this.messageCount + ')');
            console.log('Full message:', JSON.stringify(msg));
            console.log('?'.repeat(60));
        }
        
        // Send heartbeat response
        if (msg.Type === 3) {
            this.sendJsonMessage({ Type: 3 });
        }
    }
}

// Start
const client = new SimpleDTCClient();
client.connect();

// Handle Ctrl+C
process.on('SIGINT', () => {
    console.log('\n\nShutting down...');
    process.exit(0);
});