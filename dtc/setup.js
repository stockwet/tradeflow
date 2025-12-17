#!/usr/bin/env node

// Setup Helper for TradeFlow DTC Client
// This script helps you configure and test the connection to Sierra Chart

const net = require('net');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║          TradeFlow DTC Connection Setup Helper            ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

console.log('Step 1: Find your Parallels Windows IP address');
console.log('─────────────────────────────────────────────────────────────');
console.log('On your Windows machine (Parallels), open Command Prompt and run:');
console.log('  > ipconfig');
console.log('');
console.log('Look for "Ethernet adapter" or "Wireless LAN adapter"');
console.log('Find the IPv4 Address (usually 10.211.55.x or 192.168.x.x)\n');

function ask(question) {
    return new Promise(resolve => {
        rl.question(question, answer => {
            resolve(answer);
        });
    });
}

async function testConnection(host, port) {
    return new Promise((resolve) => {
        console.log(`\nTesting connection to ${host}:${port}...`);
        
        const socket = net.createConnection({
            host: host,
            port: port,
            timeout: 5000
        });
        
        let connected = false;
        
        socket.on('connect', () => {
            console.log('✓ Successfully connected to Sierra Chart DTC server!');
            connected = true;
            socket.end();
            resolve(true);
        });
        
        socket.on('timeout', () => {
            console.log('✗ Connection timeout (5 seconds)');
            console.log('  Possible issues:');
            console.log('  - Wrong IP address');
            console.log('  - Sierra Chart is not running');
            console.log('  - DTC Protocol Server is not enabled');
            console.log('  - Windows Firewall is blocking the connection');
            socket.destroy();
            resolve(false);
        });
        
        socket.on('error', (err) => {
            if (!connected) {
                console.log(`✗ Connection failed: ${err.message}`);
                console.log('  Possible issues:');
                console.log('  - Sierra Chart is not running');
                console.log('  - DTC Protocol Server is not enabled in Global Settings');
                console.log('  - Wrong port number (should be 11099)');
                console.log('  - "Allow Remote Connections" is not checked');
            }
            resolve(false);
        });
    });
}

async function main() {
    // Get IP address
    const host = await ask('\nEnter your Parallels Windows IP address: ');
    
    if (!host || host.trim() === '') {
        console.log('\n✗ No IP address provided. Exiting.');
        rl.close();
        return;
    }
    
    // Get port (with default)
    const portInput = await ask('Enter DTC port [default: 11099]: ');
    const port = portInput.trim() === '' ? 11099 : parseInt(portInput);
    
    // Test connection
    const success = await testConnection(host.trim(), port);
    
    if (success) {
        console.log('\n╔════════════════════════════════════════════════════════════╗');
        console.log('║                   Connection Successful!                   ║');
        console.log('╚════════════════════════════════════════════════════════════╝\n');
        console.log('Your configuration:');
        console.log(`  SC_HOST: '${host.trim()}'`);
        console.log(`  SC_PORT: ${port}\n`);
        console.log('Next steps:');
        console.log('1. Open dtc-client.js');
        console.log('2. Update SC_HOST to:', host.trim());
        console.log('3. Update SYMBOL to your trading symbol (e.g., ESH25, NQH25)');
        console.log('4. Run: node dtc-client.js\n');
    } else {
        console.log('\n╔════════════════════════════════════════════════════════════╗');
        console.log('║                   Connection Failed                        ║');
        console.log('╚════════════════════════════════════════════════════════════╝\n');
        console.log('Troubleshooting checklist:');
        console.log('');
        console.log('□ Is Sierra Chart running?');
        console.log('□ Is DTC Protocol Server enabled?');
        console.log('    Global Settings → General Settings → DTC Protocol Server');
        console.log('□ Is "Allow Remote Connections" checked?');
        console.log('□ Is the IP address correct?');
        console.log('    Run "ipconfig" in Windows to verify');
        console.log('□ Is Windows Firewall allowing port 11099?');
        console.log('    Open "Windows Defender Firewall with Advanced Security"');
        console.log('    Create inbound rule for port 11099');
        console.log('');
    }
    
    rl.close();
}

main().catch(err => {
    console.error('Error:', err);
    rl.close();
});