// tests/mock-controller.js
// Mock Controller CLI để test Gateway (thay thế Web App)

const WebSocket = require('ws');
const https = require('https');

console.log('Starting Mock Controller...');

const HOST = process.env.GATEWAY_HOST || 'localhost';

function login() {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ username: 'admin', password: 'admin123' });
    const req = https.request({
      hostname: HOST, port: 8080, path: '/api/login',
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      rejectUnauthorized: false
    }, (res) => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => resolve(JSON.parse(b)));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function run() {
  console.log('1. Logging in...');
  const res = await login();
  if (!res.ok) {
    console.error('❌ Login failed:', res.message);
    process.exit(1);
  }
  
  const token = res.token;
  console.log('✅ Logged in, JWT acquired.');

  const ws = new WebSocket(`wss://localhost:8080/controller?token=${token}`, { rejectUnauthorized: false });
  let targetAgentId = null;

  ws.on('open', () => {
    console.log('✅ Connected to Gateway WS');
    
    // 1. Gửi list_agents
    console.log('\n📤 Sending list_agents...');
    ws.send(JSON.stringify({ type: 'list_agents' }));
  });

  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    
    const msg = JSON.parse(data.toString());
    console.log(`\n📥 Received Message (type: ${msg.type})`);
    
    if (msg.type === 'agents_list') {
      console.dir(msg.agents, { colors: true });
      if (msg.agents.length === 0) {
         console.log('❌ No agents connected. Please start mock-agent.js first.');
         ws.close();
         return;
      }
      targetAgentId = msg.agents[0].id;
      console.log(`\n🎯 Selected target agent: ${targetAgentId}`);

      // Subscribe so the Gateway relays this agent's responses (permission_result,
      // proc_list_result) back to us. Responses without a command_id are only sent
      // to subscribed controllers (see controllerStore.broadcastToSubscribers).
      ws.send(JSON.stringify({ type: 'subscribe', agent_id: targetAgentId }));
      console.log('📤 Sent subscribe');

      // 2. Gửi permission_request
      console.log('\n📤 Sending permission_request (proc_list)...');
      ws.send(JSON.stringify({
        type: 'permission_request',
        module: 'proc_list',
        target_agents: [targetAgentId]
      }));
    }

    if (msg.type === 'permission_result') {
      console.dir(msg, { colors: true });
      if (msg.granted) {
        // 3. Gửi request lấy data
        console.log('\n📤 Permission granted! Sending request (proc_list)...');
        ws.send(JSON.stringify({
          type: 'request',
          module: 'proc_list',
          params: {},
          target_agents: [targetAgentId]
        }));
      }
    }

    if (msg.type === 'proc_list_result') {
      console.dir(msg, { colors: true });
      // 4. Gửi stop_module và kết thúc
      console.log('\n📤 Data received! Sending stop_module...');
      ws.send(JSON.stringify({
        type: 'stop_module',
        module: 'proc_list',
        target_agents: [targetAgentId]
      }));

      setTimeout(() => {
        console.log('🎉 Flow complete. Closing Controller.');
        ws.close();
      }, 1000);
    }
  });

  ws.on('close', () => console.log('❌ Disconnected from Gateway'));
}

run().catch(console.error);
