// src/server.js
// 1 HTTP server (Express for REST) + 1 ws.WebSocketServer ({ noServer: true }).
// Upgrade event routes by pathname: /agent and /controller.

const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const { URL } = require('url');

const config = require('./config');
const logger = require('./utils/logger');
const { verifyAgentKey, verifyControllerAuth } = require('./middleware/auth');
const handleAgent = require('./socket/agentHandler');
const handleController = require('./socket/controllerHandler');

// ─── Express App ───────────────────────────────────────────────
const app = express();
app.use(express.json());

// ─── CORS (for Controller web app) ─────────────────────────────
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  next();
});

// Health check
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

// ─── HTTP Server ───────────────────────────────────────────────
const httpServer = http.createServer(app);

// ─── WebSocket Server (noServer mode) ──────────────────────────
const wss = new WebSocketServer({ noServer: true });

// ─── Upgrade Handler ───────────────────────────────────────────
// Parse URL → route by pathname → authenticate → handleUpgrade.
httpServer.on('upgrade', (req, socket, head) => {
  // Parse the request URL (req.url is relative, e.g. "/agent?key=xxx")
  const baseUrl = `http://${req.headers.host || 'localhost'}`;
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
  if (pathname === '/agent') {
    if (!verifyAgentKey(query)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

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
function start() {
  httpServer.listen(config.port, () => {
    logger.info('═══════════════════════════════════════════════════');
    logger.info(`  Gateway Server started on port ${config.port}`);
    logger.info(`  Health:     http://localhost:${config.port}/health`);
    logger.info(`  Agent:      ws://localhost:${config.port}/agent`);
    logger.info(`  Controller: ws://localhost:${config.port}/controller`);
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

    // Close HTTP server
    httpServer.close(() => {
      logger.info('[server] HTTP server closed — goodbye');
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

module.exports = { app, httpServer, wss, start };
