// src/auth/login.js
// REST POST /api/login — bcrypt verify + JWT sign.
// D8: POST /api/login {username,password} -> tra users.json -> bcrypt.compare
//     -> đúng: phát JWT (8h, payload {username}) -> {ok:true, token, message}
//     -> sai:  {ok:false, token:null, message:"Sai tài khoản"}
//     Log mọi lần đăng nhập (thành công/thất bại).

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');

const config = require('../config');
const logger = require('../utils/logger');

const router = express.Router();

// Load users from JSON file (read once at startup — simple for course project)
let users = [];
try {
  users = require(path.resolve(__dirname, '..', 'store', 'users.json'));
  logger.info('[login] Loaded users.json', { count: users.length });
} catch (err) {
  logger.error('[login] Failed to load users.json', { error: err.message });
}

/**
 * POST /api/login
 * Body: { username: string, password: string }
 * Response: { ok: boolean, token: string|null, message: string }
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

  const token = jwt.sign(payload, config.jwtSecret, { expiresIn: '8h' });

  logger.info('[login] Login SUCCESS', { username });
  return res.json({
    ok: true,
    token,
    message: 'Đăng nhập thành công',
  });
});

module.exports = router;
