// src/auth/login.js
// REST POST /api/login — bcrypt verify + JWT sign (access 30m + refresh 7d in HttpOnly cookie).
// REST POST /api/refresh — check refresh token JTI, issue new 30m access token and rotate refresh token.
// REST POST /api/logout — revoke refresh token JTI in Map + clear cookie.

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const config = require('../config');
const logger = require('../utils/logger');

const router = express.Router();

// Load users from JSON file (read once at startup)
let users = [];
try {
  users = require(path.resolve(__dirname, '..', 'store', 'users.json'));
  logger.info('[login] Loaded users.json', { count: users.length });
} catch (err) {
  logger.error('[login] Failed to load users.json', { error: err.message });
}

// In-memory Map to store valid refresh token JTIs for revocation
// Map<jti, { username, createdAt }>
const activeRefreshTokens = new Map();

/**
 * POST /api/login
 * Body: { username: string, password: string }
 * Response: { ok: boolean, token: string|null, message: string } (Refresh token set in HttpOnly Cookie)
 */
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  // --- Validate input ---
  if (!username || !password) {
    logger.warn('[login] Login FAILED: missing username or password');
    return res.status(400).json({
      ok: false,
      token: null,
      message: 'Username and password are required',
    });
  }

  // --- Find user ---
  const user = users.find((u) => u.username === username);
  if (!user) {
    logger.warn('[login] Login FAILED: unknown username', { username });
    return res.status(401).json({
      ok: false,
      token: null,
      message: 'Sai tài khoản hoặc mật khẩu',
    });
  }

  // --- Verify password with bcrypt ---
  try {
    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      logger.warn('[login] Login FAILED: wrong password', { username });
      return res.status(401).json({
        ok: false,
        token: null,
        message: 'Sai tài khoản hoặc mật khẩu',
      });
    }
  } catch (err) {
    logger.error('[login] bcrypt error', { error: err.message });
    return res.status(500).json({
      ok: false,
      token: null,
      message: 'Internal server error',
    });
  }

  // --- Sign JWT ---
  if (!config.jwtSecret) {
    logger.warn('[login] JWT_SECRET not configured, cannot issue token');
    return res.status(500).json({
      ok: false,
      token: null,
      message: 'JWT is not configured on this server',
    });
  }

  const payload = { username: user.username };

  // 1. Access token TTL reduced from 8h to 30 minutes
  const token = jwt.sign(payload, config.jwtSecret, { expiresIn: '30m' });

  // 2. Issue refresh token with 7-day TTL and store JTI in Map
  const jti = uuidv4();
  const refreshPayload = { username: user.username, jti };
  const refreshToken = jwt.sign(refreshPayload, config.jwtSecret, { expiresIn: '7d' });

  activeRefreshTokens.set(jti, { username: user.username, createdAt: Date.now() });

  // 4. Set refresh token via HttpOnly Cookie (NOT in response body)
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: config.tlsEnabled, // Secure when WSS/TLS enabled
    sameSite: 'Strict',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
  });

  logger.info('[login] Login SUCCESS & refresh token issued', { username, jti });
  return res.json({
    ok: true,
    token,
    message: 'Đăng nhập thành công',
  });
});

/**
 * POST /api/refresh
 * Reads refreshToken from HttpOnly Cookie (or body fallback), verifies JTI,
 * issues a new 30m access token, and rotates the refresh token.
 */
router.post('/refresh', (req, res) => {
  const token = req.cookies?.refreshToken || req.body?.refreshToken;

  if (!token) {
    logger.warn('[refresh] FAILED: No refresh token provided');
    return res.status(401).json({
      ok: false,
      token: null,
      message: 'Refresh token required',
    });
  }

  if (!config.jwtSecret) {
    return res.status(500).json({ ok: false, token: null, message: 'JWT not configured' });
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    const jti = decoded.jti;

    if (!jti || !activeRefreshTokens.has(jti)) {
      logger.warn('[refresh] FAILED: Revoked or unrecognized JTI', { jti, username: decoded.username });
      return res.status(401).json({
        ok: false,
        token: null,
        message: 'Invalid or revoked refresh token',
      });
    }

    // Rotate refresh token: revoke old JTI and generate a new one
    activeRefreshTokens.delete(jti);
    const newJti = uuidv4();
    const newRefreshToken = jwt.sign({ username: decoded.username, jti: newJti }, config.jwtSecret, { expiresIn: '7d' });
    activeRefreshTokens.set(newJti, { username: decoded.username, createdAt: Date.now() });

    res.cookie('refreshToken', newRefreshToken, {
      httpOnly: true,
      secure: config.tlsEnabled,
      sameSite: 'Strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    // Issue new 30-minute access token
    const newAccessToken = jwt.sign({ username: decoded.username }, config.jwtSecret, { expiresIn: '30m' });

    logger.info('[refresh] Token refreshed & rotated successfully', { username: decoded.username, oldJti: jti, newJti });
    return res.json({
      ok: true,
      token: newAccessToken,
      message: 'Token refreshed successfully',
    });
  } catch (err) {
    logger.warn('[refresh] FAILED: Token verification failed', { error: err.message });
    return res.status(401).json({
      ok: false,
      token: null,
      message: 'Expired or invalid refresh token',
    });
  }
});

/**
 * POST /api/logout
 * Revokes refresh token JTI in Map and clears HttpOnly cookie.
 */
router.post('/logout', (req, res) => {
  const token = req.cookies?.refreshToken || req.body?.refreshToken;

  if (token && config.jwtSecret) {
    try {
      const decoded = jwt.decode(token);
      if (decoded && decoded.jti && activeRefreshTokens.has(decoded.jti)) {
        activeRefreshTokens.delete(decoded.jti);
        logger.info('[logout] Revoked refresh token JTI', { jti: decoded.jti, username: decoded.username });
      }
    } catch (err) {
      logger.debug('[logout] Error decoding token during logout', { error: err.message });
    }
  }

  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure: config.tlsEnabled,
    sameSite: 'Strict',
  });

  return res.json({
    ok: true,
    message: 'Đăng xuất thành công',
  });
});

// Attach activeRefreshTokens to router for test access and transparency
router.activeRefreshTokens = activeRefreshTokens;

module.exports = router;
