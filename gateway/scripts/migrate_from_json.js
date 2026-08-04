#!/usr/bin/env node
// scripts/migrate_from_json.js
// Migration script to read existing credentials from src/store/users.json
// and src/store/agents.json, and write them into SQLite database via src/db.js.

const fs = require('fs');
const path = require('path');
const { queries } = require('../src/db');

console.log('🔄 Bắt đầu migrate dữ liệu từ JSON sang SQLite...\n');

// 1. Migrate users.json
const usersPath = path.resolve(__dirname, '..', 'src', 'store', 'users.json');
if (fs.existsSync(usersPath)) {
  try {
    const rawUsers = fs.readFileSync(usersPath, 'utf-8');
    const users = JSON.parse(rawUsers);
    let count = 0;
    if (Array.isArray(users)) {
      for (const u of users) {
        if (u.username) {
          const passHash = u.passwordHash || u.password_hash || '';
          const role = u.role || 'admin';
          queries.upsertUser(u.username, passHash, role);
          count++;
          console.log(`👤 Đã migrate user: "${u.username}" (role: ${role})`);
        }
      }
    }
    console.log(`✅ Đã hoàn tất migrate ${count} user từ users.json vào SQLite.\n`);
  } catch (err) {
    console.error('❌ Lỗi khi đọc hoặc migrate users.json:', err.message);
  }
} else {
  console.warn('⚠️ Không tìm thấy file users.json, bỏ qua migrate users.\n');
}

// 2. Migrate agents.json
const agentsPath = path.resolve(__dirname, '..', 'src', 'store', 'agents.json');
if (fs.existsSync(agentsPath)) {
  try {
    const rawAgents = fs.readFileSync(agentsPath, 'utf-8');
    const agents = JSON.parse(rawAgents);
    let count = 0;
    if (Array.isArray(agents)) {
      for (const a of agents) {
        if (a.agent_id) {
          const secretHash = a.secretHash || a.secret_hash || '';
          const displayName = a.display_name || a.agent_id;
          const createdAt = a.created_at || Date.now();
          queries.upsertAgent(a.agent_id, secretHash, displayName, createdAt);
          count++;
          console.log(`🤖 Đã migrate agent: "${a.agent_id}" (display: "${displayName}")`);
        }
      }
    }
    console.log(`✅ Đã hoàn tất migrate ${count} agent từ agents.json vào SQLite.\n`);
  } catch (err) {
    console.error('❌ Lỗi khi đọc hoặc migrate agents.json:', err.message);
  }
} else {
  console.warn('⚠️ Không tìm thấy file agents.json, bỏ qua migrate agents.\n');
}

console.log('🎉 Quá trình migration đã hoàn thành!');
