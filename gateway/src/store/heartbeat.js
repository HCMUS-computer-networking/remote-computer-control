// src/managers/heartbeat.js
// Ping-Pong heartbeat mechanism for WebSocket connections.
// Detects dead connections early by sending periodic pings and
// terminating sockets that don't respond with a pong in time.

const config = require('../config');
const logger = require('../utils/logger');

/**
 * Attach heartbeat monitoring to a WebSocket.
 * Sends a WS-level ping every PING_INTERVAL ms.
 * If no pong is received within PING_TIMEOUT ms, the socket is terminated.
 *
 * @param {WebSocket} ws - The WebSocket to monitor
 * @param {string} label - Identifier for logging (e.g. "agent:PC-Lab-01" or "controller:1")
 * @returns {{ clear: () => void }} Call clear() to stop heartbeat (e.g. on close)
 */
function attach(ws, label) {
  let isAlive = true;

  // When we receive a pong, mark as alive
  ws.on('pong', () => {
    isAlive = true;
  });

  const interval = setInterval(() => {
    if (!isAlive) {
      logger.warn('[heartbeat] No pong received, terminating', { label });
      ws.terminate();
      clearInterval(interval);
      return;
    }

    isAlive = false;

    // ── Check access token expiration (for JWT authenticated sessions) ──
    if (ws._gwJwtPayload && typeof ws._gwJwtPayload.exp === 'number') {
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (nowSeconds >= ws._gwJwtPayload.exp) {
        logger.warn('[auth] Access token expired during active WebSocket session', { label, exp: ws._gwJwtPayload.exp });
        try {
          ws.send(JSON.stringify({ type: 'auth_expired' }));
        } catch (err) {
          // ignore send error on closing socket
        }
        ws.close(4001, 'auth_expired');
        clearInterval(interval);
        return;
      }
    }

    try {
      ws.ping();
    } catch (err) {
      logger.error('[heartbeat] Ping failed', {
        label,
        error: err.message,
      });
      ws.terminate();
      clearInterval(interval);
    }
  }, config.pingInterval);

  return {
    clear() {
      clearInterval(interval);
    },
  };
}

module.exports = { attach };
