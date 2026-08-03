// src/server.js
// Phase 1: Security Hardening — HTTPS/WSS + CORS Whitelist + Rate Limiting.
//
// 1 HTTP/HTTPS server (Express for REST) + 1 ws.WebSocketServer ({ noServer: true }).
// Upgrade event routes by pathname: /agent and /controller.
// Automatically selects HTTPS/WSS when SSL_CERT_PATH and SSL_KEY_PATH are configured.

const http = require('http');
const https = require('https');
const fs = require('fs');
const express = require('express');

const rateLimit = require('express-rate-limit');
const { WebSocketServer } = require('ws');
const { URL } = require('url');

const config = require('./config');
const logger = require('./utils/logger');
const { verifyControllerAuth } = require('./middleware/auth');
const handleAgent = require('./socket/agentHandler');
const handleController = require('./socket/controllerHandler');

// ─── Express App ───────────────────────────────────────────────
const cookieParser = require('cookie-parser');
const app = express();
app.use(express.json());
app.use(cookieParser());

// ─── CORS Whitelist (Phase 1: Security Hardening) ──────────────
// Hand-rolled middleware — reads ALLOWED_ORIGINS from config (comma-separated).
// Preflight OPTIONS returns 403 if the origin is not in the whitelist.
const allowedOriginsList = config.allowedOrigins
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin && allowedOriginsList.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Credentials', 'true');
  }

  // Preflight: respond immediately
  if (req.method === 'OPTIONS') {
    if (!origin || !allowedOriginsList.includes(origin)) {
      logger.warn('[cors] Preflight BLOCKED — origin not in whitelist', { origin });
      return res.status(403).json({ ok: false, message: 'CORS: origin not allowed' });
    }
    return res.sendStatus(204);
  }

  next();
});

logger.info('[security] CORS configured', {
  allowedOrigins: allowedOriginsList,
});

// ─── Rate Limiting — Login only (Phase 1: Security Hardening) ──
// 10 requests per minute per IP on POST /api/login.
// NOT applied globally — avoids blocking WS handshake or normal traffic.
const loginLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,             // 10 attempts per window per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    token: null,
    message: 'Too many login attempts. Please try again later.',
  },
  handler: (req, res, _next, options) => {
    logger.warn('[rate-limit] Login brute-force protection triggered', {
      ip: req.ip,
      username: req.body?.username || 'unknown',
    });
    res.status(options.statusCode).json(options.message);
  },
});
app.use('/api/login', loginLimiter);

logger.info('[security] Rate limiting configured', {
  loginLimit: '10 attempts / 60s per IP',
});



// ─── Health check ──────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// GET /api/agents - Return all connected agents
const agentStore = require('./store/agentStore');
app.get('/api/agents', (_req, res) => {
  res.json({ agents: agentStore.getAll() });
});

// REST routes
const loginRouter = require('./auth/login');
app.use('/api', loginRouter);

// ─── HTTP / HTTPS Server (Phase 1: TLS Support) ───────────────
// TLS_ENABLED=true  → https.createServer (wss://)
// TLS_ENABLED=false → http.createServer  (ws://)  — dev mode
let server;
let protocol;

if (config.tlsEnabled) {
  try {
    const tlsOptions = {
      cert: fs.readFileSync(config.tlsCertPath),
      key: fs.readFileSync(config.tlsKeyPath),
    };
    server = https.createServer(tlsOptions, app);
    protocol = 'https';
    logger.info('[security] TLS enabled — running in HTTPS/WSS mode', {
      cert: config.tlsCertPath,
      key: config.tlsKeyPath,
    });
  } catch (err) {
    logger.error('[security] TLS_ENABLED=true but failed to load certificates — aborting', {
      error: err.message,
      certPath: config.tlsCertPath,
      keyPath: config.tlsKeyPath,
    });
    process.exit(1);
  }
} else {
  server = http.createServer(app);
  protocol = 'http';
  logger.warn('[security] TLS disabled — running in plain HTTP/WS mode (dev only)');
}

// ─── WebSocket Server (noServer mode) ──────────────────────────
const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024 });

// ─── Upgrade Handler ───────────────────────────────────────────
// Parse URL → route by pathname → authenticate → handleUpgrade.
server.on('upgrade', (req, socket, head) => {
  // Parse the request URL (req.url is relative, e.g. "/agent?key=xxx")
  const baseUrl = `${protocol}://${req.headers.host || 'localhost'}`;
  let parsedUrl;
  try {
    parsedUrl = new URL(req.url, baseUrl);
  } catch {
    logger.warn('[upgrade] Failed to parse URL, destroying socket', {
      url: req.url,
    });
    socket.destroy();
    return;
  }

  const pathname = parsedUrl.pathname;
  const query = parsedUrl.searchParams;

  // ── /agent path ────────────────────────────────────────────
  // Authentication moves to REGISTER message handshake with { agent_id, secret }
  if (pathname === '/agent') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      // Tag the socket so handlers can distinguish agent vs controller
      ws._gwRole = 'agent';
      ws._gwAuthTime = Date.now();
      wss.emit('connection', ws, req, 'agent');
    });
    return;
  }

  // ── /controller path ──────────────────────────────────────
  if (pathname === '/controller') {
    const authResult = verifyControllerAuth(query);
    if (!authResult.ok) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      ws._gwRole = 'controller';
      ws._gwAuthTime = Date.now();
      ws._gwJwtPayload = authResult.payload; // null if key-auth
      wss.emit('connection', ws, req, 'controller');
    });
    return;
  }

  // ── Unknown path ──────────────────────────────────────────
  logger.warn('[upgrade] Unknown path, destroying socket', { pathname });
  socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
  socket.destroy();
});

// ─── WSS Connection Dispatcher ─────────────────────────────────
// Route to the appropriate handler based on role tag set during upgrade.
wss.on('connection', (ws, req, role) => {
  if (role === 'agent') {
    handleAgent(ws, req);
  } else if (role === 'controller') {
    handleController(ws, req);
  }
});

// ─── Start ─────────────────────────────────────────────────────
const wsProtocol = protocol === 'https' ? 'wss' : 'ws';

function start() {
  server.listen(config.port, () => {
    logger.info('═══════════════════════════════════════════════════');
    logger.info(`  Gateway Server started on port ${config.port}`);
    logger.info(`  Mode:       ${protocol.toUpperCase()} / ${wsProtocol.toUpperCase()}`);
    logger.info(`  Health:     ${protocol}://localhost:${config.port}/health`);
    logger.info(`  Agent:      ${wsProtocol}://localhost:${config.port}/agent`);
    logger.info(`  Controller: ${wsProtocol}://localhost:${config.port}/controller`);
    logger.info('═══════════════════════════════════════════════════');
  });
}

// ─── Graceful Shutdown ─────────────────────────────────────────
function shutdown(signal) {
  logger.info(`[server] ${signal} received — shutting down gracefully...`);

  // Close all WebSocket connections
  for (const client of wss.clients) {
    try {
      client.close(1001, 'Server shutting down');
    } catch {
      // ignore
    }
  }

  // Close WebSocket server
  wss.close(() => {
    logger.info('[server] WebSocket server closed');

    // Close HTTP/HTTPS server
    server.close(() => {
      logger.info('[server] HTTP/HTTPS server closed — goodbye');
      process.exit(0);
    });
  });

  // Force exit after 5s if graceful shutdown hangs
  setTimeout(() => {
    logger.warn('[server] Forced exit after timeout');
    process.exit(1);
  }, 5000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = { app, httpServer: server, wss, start };
