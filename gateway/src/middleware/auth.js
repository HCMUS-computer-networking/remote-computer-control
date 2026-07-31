// src/middleware/auth.js
// Authentication helpers for WebSocket handshake.
// D4: Auth key ở query-param khi handshake.
// D8: Controller xác thực JWT ở query ?token=, fallback ?key=CONTROLLER_KEY.
// D9: Bỏ gatewayKey per-lệnh, xác thực chỉ ở handshake.

const jwt = require('jsonwebtoken');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Verify Agent connection key from query params.
 * @param {URLSearchParams} query - Parsed query parameters from upgrade URL
 * @returns {boolean} true if key is valid
 */
function verifyAgentKey(query) {
  const key = query.get('key');

  if (!key) {
    logger.warn('[auth] Agent connection REJECTED: missing ?key parameter');
    return false;
  }

  if (key !== config.agentKey) {
    logger.warn('[auth] Agent connection REJECTED: invalid key');
    return false;
  }

  return true;
}

/**
 * Verify Controller connection auth from query params.
 * Tries JWT (?token=) first if JWT_SECRET is configured, then falls back to ?key=.
 * @param {URLSearchParams} query - Parsed query parameters from upgrade URL
 * @returns {{ ok: boolean, payload: object|null }} ok=true if auth passed; payload = decoded JWT or null
 */
function verifyControllerAuth(query) {
  const token = query.get('token');
  const key = query.get('key');

  // --- Try JWT first (if JWT_SECRET is configured) ---
  if (token && config.jwtSecret) {
    try {
      const payload = jwt.verify(token, config.jwtSecret);
      logger.info('[auth] Controller authenticated via JWT', {
        username: payload.username,
      });
      return { ok: true, payload };
    } catch (err) {
      logger.warn('[auth] Controller JWT verification FAILED', {
        error: err.message,
      });
      // Don't return false yet — fall through to key check
    }
  }

  // --- Fallback: shared key ---
  if (key) {
    if (key === config.controllerKey) {
      logger.info('[auth] Controller authenticated via shared key');
      return { ok: true, payload: null };
    }
    logger.warn('[auth] Controller connection REJECTED: invalid key');
    return { ok: false, payload: null };
  }

  // --- Neither token nor key provided ---
  logger.warn(
    '[auth] Controller connection REJECTED: no ?token= or ?key= provided'
  );
  return { ok: false, payload: null };
}

module.exports = { verifyAgentKey, verifyControllerAuth };
