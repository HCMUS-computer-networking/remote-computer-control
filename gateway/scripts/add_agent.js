#!/usr/bin/env node
// scripts/add_agent.js
// CLI script to add or update an agent credential in src/store/agents.json
// Usage: node scripts/add_agent.js <agent_id>
// Generates a random 32-byte hex secret, hashes it with bcrypt, saves to agents.json,
// and prints the plain text secret to the console to be copied to agent/config.json.

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { queries } = require('../src/db');

const agentId = process.argv[2];
if (!agentId || agentId.trim() === '') {
  console.error('❌ Lỗi: Thiếu tham số agent_id.');
  console.error('👉 Sử dụng: node scripts/add_agent.js <agent_id>');
  process.exit(1);
}

// Generate random secret (32 bytes -> 64 hex characters)
const secret = crypto.randomBytes(32).toString('hex');

// Hash secret using bcrypt
console.log('⏳ Đang mã hóa secret bằng bcrypt...');
const secretHash = bcrypt.hashSync(secret, 10);

// Update or add agent entry in SQLite database
queries.upsertAgent(agentId, secretHash, agentId, Date.now());
console.log(`✅ Đã thêm/cập nhật agent vào cơ sở dữ liệu SQLite: "${agentId}"`);

console.log('\n════════════════════════════════════════════════════════════════');
console.log(`🔑 SECRET (PLAIN TEXT):`);
console.log(`\n    ${secret}\n`);
console.log(`⚠️  Hãy copy chuỗi secret ở trên và dán vào file cấu hình (config.json) của Agent!`);
console.log(`🔒 Hệ thống chỉ lưu bản băm bcrypt trong CSL (SQLite).`);
console.log('════════════════════════════════════════════════════════════════\n');

