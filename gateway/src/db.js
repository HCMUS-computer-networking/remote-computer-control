// src/db.js
// SQLite database connection and schema initialization using better-sqlite3.
// Replaces in-memory Maps and static JSON files for users, agents, and refresh tokens.

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const logger = require('./utils/logger');

const dbPath = process.env.DB_PATH || path.resolve(__dirname, 'store', 'data.sqlite');

// Ensure directory exists
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// Initialize database tables on startup
function initSchema() {
  const schema = `
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'admin'
    );

    CREATE TABLE IF NOT EXISTS agents (
      agent_id TEXT PRIMARY KEY,
      secret_hash TEXT NOT NULL,
      display_name TEXT,
      created_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS refresh_tokens (
      jti TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `;
  db.exec(schema);
  logger.info('[db] SQLite schema verified/initialized', { path: dbPath });
}

initSchema();

// ─── User Helper Queries ──────────────────────────────────────
const getUserByUsernameStmt = db.prepare('SELECT * FROM users WHERE username = ?');
const getUserByIdStmt = db.prepare('SELECT * FROM users WHERE id = ?');
const upsertUserStmt = db.prepare(`
  INSERT INTO users (username, password_hash, role)
  VALUES (?, ?, ?)
  ON CONFLICT(username) DO UPDATE SET
    password_hash = excluded.password_hash,
    role = excluded.role
`);

// ─── Agent Helper Queries ─────────────────────────────────────
const getAgentByIdStmt = db.prepare('SELECT * FROM agents WHERE agent_id = ?');
const getAllAgentsStmt = db.prepare('SELECT * FROM agents');
const upsertAgentStmt = db.prepare(`
  INSERT INTO agents (agent_id, secret_hash, display_name, created_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(agent_id) DO UPDATE SET
    secret_hash = excluded.secret_hash,
    display_name = COALESCE(excluded.display_name, agents.display_name)
`);

// ─── Refresh Token Helper Queries ─────────────────────────────
const insertRefreshTokenStmt = db.prepare('INSERT OR REPLACE INTO refresh_tokens (jti, user_id, expires_at) VALUES (?, ?, ?)');
const getRefreshTokenStmt = db.prepare('SELECT * FROM refresh_tokens WHERE jti = ?');
const deleteRefreshTokenStmt = db.prepare('DELETE FROM refresh_tokens WHERE jti = ?');
const cleanExpiredTokensStmt = db.prepare('DELETE FROM refresh_tokens WHERE expires_at < ?');

const queries = {
  getUserByUsername: (username) => getUserByUsernameStmt.get(username),
  getUserById: (id) => getUserByIdStmt.get(id),
  upsertUser: (username, passwordHash, role = 'admin') => upsertUserStmt.run(username, passwordHash, role),

  getAgentById: (agentId) => getAgentByIdStmt.get(agentId),
  getAllAgents: () => getAllAgentsStmt.all(),
  upsertAgent: (agentId, secretHash, displayName = '', createdAt = Date.now()) => upsertAgentStmt.run(agentId, secretHash, displayName, createdAt),

  insertRefreshToken: (jti, userId, expiresAt) => insertRefreshTokenStmt.run(jti, userId, expiresAt),
  getRefreshToken: (jti) => getRefreshTokenStmt.get(jti),
  deleteRefreshToken: (jti) => deleteRefreshTokenStmt.run(jti),
  cleanExpiredTokens: (nowMs = Date.now()) => cleanExpiredTokensStmt.run(nowMs),
};

module.exports = {
  db,
  queries,
  initSchema,
};
