// tests/mock-agent.js
// Mock Agent CLI để test Gateway (thay thế Agent C#)

const WebSocket = require('ws');

const AGENT_KEY = 'agent-secret-key-2024';
const GATEWAY_URL = `wss://localhost:8080/agent?key=${AGENT_KEY}`;
const AGENT_ID = 'MOCK-AGENT-999';

console.log('Starting Mock Agent...');
const ws = new WebSocket(GATEWAY_URL, { rejectUnauthorized: false });

ws.on('open', () => {
  console.log('✅ Connected to Gateway');
  
  const registerMsg = {
    type: 'REGISTER',
    agent_id: AGENT_ID,
    hostname: 'Mock-PC',
    ip: '127.0.0.1',
    os: 'Windows 10 Mock'
  };
  
  ws.send(JSON.stringify(registerMsg));
  console.log('📤 Sent REGISTER');
});

ws.on('message', (data, isBinary) => {
  if (isBinary) {
    console.log(`📥 Received Binary Data (${data.length} bytes)`);
    return;
  }

  const msg = JSON.parse(data.toString());
  console.log(`\n📥 Received Message (type: ${msg.type}, module: ${msg.module})`);
  console.dir(msg, { depth: null, colors: true });

  // Handle some mock scenarios based on Controller's requests
  if (msg.type === 'permission_request') {
    // Usually Agent prompts user and sends back permission_result
    // But Gateway only relays it. Let's send a fake result back to controller
    const response = {
      type: 'permission_result',
      module: msg.module,
      granted: true // MOCK: User clicked "Allow"
    };
    setTimeout(() => {
      ws.send(JSON.stringify(response));
      console.log('📤 Sent permission_result');
    }, 1000);
  }

  if (msg.type === 'request' && msg.module === 'proc_list') {
    // Controller wants process list
    const response = {
      type: 'proc_list_result',
      processes: [
        { pid: 1000, name: 'mock_process.exe', cpu_percent: 5.5, ram_mb: 120 },
        { pid: 1004, name: 'system.exe', cpu_percent: 1.0, ram_mb: 200 }
      ]
    };
    setTimeout(() => {
      ws.send(JSON.stringify(response));
      console.log('📤 Sent proc_list_result');
    }, 1000);
  }

  if (msg.type === 'stop_module') {
    console.log('🛑 Controller requested stop_module. Shutting down gracefully.');
    ws.close();
    process.exit(0);
  }
});

ws.on('close', () => {
  console.log('❌ Disconnected from Gateway');
});

ws.on('error', (err) => {
  console.error('WebSocket Error:', err.message);
});
