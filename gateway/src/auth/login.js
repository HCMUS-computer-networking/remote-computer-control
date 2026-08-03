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
const { queries } = require('../db');

const router = express.Router();

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

  const role = user.role || 'admin';
  const payload = { username: user.username, role };

  // 1. Access token TTL 30 minutes, embedding role
  const token = jwt.sign(payload, config.jwtSecret, { expiresIn: '30m' });

  // 2. Issue refresh token with 7-day TTL and save JTI to SQLite
  const jti = uuidv4();
  const refreshPayload = { username: user.username, jti };
  const refreshToken = jwt.sign(refreshPayload, config.jwtSecret, { expiresIn: '7d' });
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;

  queries.insertRefreshToken(jti, user.id, expiresAt);
  queries.cleanExpiredTokens(Date.now());

  // 4. Set refresh token via HttpOnly Cookie (NOT in response body)
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: config.tlsEnabled, // Secure when WSS/TLS enabled
    sameSite: 'Strict',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
  });

  logger.info('[login] Login SUCCESS & refresh token saved to SQLite', { username, role, jti });
  return res.json({
    ok: true,
    token,
    message: 'Đăng nhập thành công',
  });
});

/**
 * POST /api/refresh
 * Reads refreshToken from HttpOnly Cookie (or body fallback), verifies JTI in SQLite,
 * issues a new 30m access token with role, and rotates the refresh token in DB.
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

    if (!jti) {
      return res.status(401).json({ ok: false, token: null, message: 'Invalid refresh token' });
    }

    // Verify JTI exists and has not expired in SQLite
    const tokenRecord = queries.getRefreshToken(jti);
    if (!tokenRecord || tokenRecord.expires_at < Date.now()) {
      logger.warn('[refresh] FAILED: Revoked or expired JTI in SQLite', { jti, username: decoded.username });
      if (tokenRecord) {
        queries.deleteRefreshToken(jti);
      }
      return res.status(401).json({
        ok: false,
        token: null,
        message: 'Invalid or expired refresh token',
      });
    }

    // Get latest user info from DB
    const user = queries.getUserById(tokenRecord.user_id) || queries.getUserByUsername(decoded.username);
    if (!user) {
      logger.warn('[refresh] FAILED: User associated with token no longer exists in DB');
      queries.deleteRefreshToken(jti);
      return res.status(401).json({ ok: false, token: null, message: 'User no longer exists' });
    }

    const role = user.role || 'admin';

    // Rotate refresh token: delete old JTI and generate a new one in SQLite
    queries.deleteRefreshToken(jti);
    const newJti = uuidv4();
    const newRefreshToken = jwt.sign({ username: user.username, jti: newJti }, config.jwtSecret, { expiresIn: '7d' });
    const newExpiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
    queries.insertRefreshToken(newJti, user.id, newExpiresAt);

    res.cookie('refreshToken', newRefreshToken, {
      httpOnly: true,
      secure: config.tlsEnabled,
      sameSite: 'Strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    // Issue new 30-minute access token embedding role
    const newAccessToken = jwt.sign({ username: user.username, role }, config.jwtSecret, { expiresIn: '30m' });

    logger.info('[refresh] Token refreshed & rotated successfully via SQLite', { username: user.username, role, oldJti: jti, newJti });
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
      if (decoded && decoded.jti) {
        queries.deleteRefreshToken(decoded.jti);
        logger.info('[logout] Revoked refresh token JTI in SQLite', { jti: decoded.jti, username: decoded.username });
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

module.exports = router;
