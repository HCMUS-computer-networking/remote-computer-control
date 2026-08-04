// src/middleware/auth.js
// Authentication helpers for WebSocket handshake.
// Note: Agent authentication now happens during the REGISTER message via bcrypt (agentStore.js), not at HTTP upgrade.
// D8: Controller xác thực JWT ở query ?token=, fallback ?key=CONTROLLER_KEY.

const jwt = require('jsonwebtoken');
const config = require('../config');
const logger = require('../utils/logger');

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

module.exports = { verifyControllerAuth };
