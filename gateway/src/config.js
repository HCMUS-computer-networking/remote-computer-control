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

  // ─── TLS (Phase 1: Security Hardening) ─────────────────────────
  // Enabled by default (HTTPS/WSS). Set TLS_ENABLED=false to run
  // plain HTTP/WS instead (dev mode).
  //
  // Generate a self-signed certificate for local testing:
  //   openssl req -x509 -newkey rsa:2048 -nodes \
  //     -keyout certs/server.key -out certs/server.cert \
  //     -days 365 -subj "/CN=localhost"
  //
  tlsEnabled: process.env.TLS_ENABLED !== 'false',
  tlsCertPath: process.env.TLS_CERT_PATH || './certs/server.cert',
  tlsKeyPath: process.env.TLS_KEY_PATH || './certs/server.key',

  // ─── CORS Whitelist (Phase 1: Security Hardening) ────────────
  // Comma-separated list of allowed origins for CORS.
  // Example: "http://localhost:5173,https://controller.example.com"
  // Default: Vite dev server port for Controller.
  allowedOrigins: process.env.ALLOWED_ORIGINS || 'http://localhost:5173',

  // ─── Rate Limiting (Phase 1: Security Hardening) ─────────────
  // Window duration (ms) and max requests per window for REST API.
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000, // 15 minutes
  rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 100,       // 100 requests per window

  // Stricter limit specifically for /api/login (anti brute-force).
  loginRateLimitWindowMs: parseInt(process.env.LOGIN_RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000, // 15 minutes
  loginRateLimitMaxRequests: parseInt(process.env.LOGIN_RATE_LIMIT_MAX_REQUESTS, 10) || 10,       // 10 attempts per window
};

// --- Validation ---
const required = ['controllerKey'];
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
