// src/config.js
// Load environment variables and export validated config object.

const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const config = {
  // Server
  port: parseInt(process.env.PORT, 10) || 8080,

  // Authentication keys
  agentKey: process.env.AGENT_KEY || '',
  controllerKey: process.env.CONTROLLER_KEY || '',
  jwtSecret: process.env.JWT_SECRET || '',

  // Heartbeat (ms)
  pingInterval: parseInt(process.env.PING_INTERVAL, 10) || 30000,
  pingTimeout: parseInt(process.env.PING_TIMEOUT, 10) || 10000,

  // Logging
  logLevel: process.env.LOG_LEVEL || 'info',
};

// --- Validation ---
const required = ['agentKey', 'controllerKey'];
const missing = required.filter((key) => !config[key]);

if (missing.length > 0) {
  console.error(
    `[config] FATAL: Missing required env vars: ${missing.join(', ')}. Check .env file.`
  );
  process.exit(1);
}

if (!config.jwtSecret) {
  console.warn(
    '[config] WARNING: JWT_SECRET is not set. JWT authentication will be disabled; falling back to CONTROLLER_KEY only.'
  );
}

module.exports = config;
