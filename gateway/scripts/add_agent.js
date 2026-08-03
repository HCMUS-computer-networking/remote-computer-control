#!/usr/bin/env node
// scripts/add_agent.js
// CLI script to add or update an agent credential in src/store/agents.json
// Usage: node scripts/add_agent.js <agent_id>
// Generates a random 32-byte hex secret, hashes it with bcrypt, saves to agents.json,
// and prints the plain text secret to the console to be copied to agent/config.json.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const agentId = process.argv[2];
if (!agentId || agentId.trim() === '') {
  console.error('❌ Lỗi: Thiếu tham số agent_id.');
  console.error('👉 Sử dụng: node scripts/add_agent.js <agent_id>');
  process.exit(1);
}

const agentsFilePath = path.resolve(__dirname, '..', 'src', 'store', 'agents.json');

// Load existing agents list
let agents = [];
if (fs.existsSync(agentsFilePath)) {
  try {
    const raw = fs.readFileSync(agentsFilePath, 'utf-8');
    agents = JSON.parse(raw);
    if (!Array.isArray(agents)) {
      agents = [];
    }
  } catch (err) {
    console.warn('⚠️ File agents.json bị lỗi định dạng, khởi tạo mảng mới.');
    agents = [];
  }
}

// Generate random secret (32 bytes -> 64 hex characters)
const secret = crypto.randomBytes(32).toString('hex');

// Hash secret using bcrypt
console.log('⏳ Đang mã hóa secret bằng bcrypt...');
const secretHash = bcrypt.hashSync(secret, 10);

// Update or add agent entry
const existingIndex = agents.findIndex((item) => item.agent_id === agentId);
if (existingIndex !== -1) {
  agents[existingIndex].secretHash = secretHash;
  console.log(`♻️  Đã cập nhật secret mới cho agent_id hiện có: "${agentId}"`);
} else {
  agents.push({ agent_id: agentId, secretHash });
  console.log(`✅  Đã thêm agent mới vào hệ thống: "${agentId}"`);
}

// Save back to agents.json
fs.writeFileSync(agentsFilePath, JSON.stringify(agents, null, 2), 'utf-8');

console.log('\n════════════════════════════════════════════════════════════════');
console.log(`🔑 SECRET (PLAIN TEXT):`);
console.log(`\n    ${secret}\n`);
console.log(`⚠️  Hãy copy chuỗi secret ở trên và dán vào file cấu hình (config.json) của Agent!`);
console.log(`🔒 Hệ thống chỉ lưu bản băm bcrypt trong src/store/agents.json.`);
console.log('════════════════════════════════════════════════════════════════\n');
