#!/usr/bin/env node
// scripts/hash-password.js
// Tiện ích sinh bcrypt hash cho mật khẩu mới.
//
// Sử dụng:
//   node scripts/hash-password.js admin123
//   node scripts/hash-password.js "my secure password"
//
// Copy hash vào src/store/users.json

const bcrypt = require('bcryptjs');

const password = process.argv[2];

if (!password) {
  console.error('Usage: node scripts/hash-password.js <password>');
  console.error('Example: node scripts/hash-password.js admin123');
  process.exit(1);
}

const SALT_ROUNDS = 10;
const hash = bcrypt.hashSync(password, SALT_ROUNDS);

console.log(`Password: ${password}`);
console.log(`Hash:     ${hash}`);
console.log(`\nCopy hash vào src/store/users.json`);
