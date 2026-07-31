// src/utils/logger.js
// Winston logger — console (colorized) + file (logs/gateway.log).
// Requirement D7: log mọi kết nối/ngắt/đăng ký + mọi message đi qua.

const winston = require('winston');
const path = require('path');
const config = require('../config');

const { combine, timestamp, printf, colorize, errors } = winston.format;

// Custom log format
const logFormat = printf(({ level, message, timestamp, ...meta }) => {
  const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
  return `[${timestamp}] [${level}] ${message}${metaStr}`;
});

const logger = winston.createLogger({
  level: config.logLevel,
  format: combine(
    errors({ stack: true }),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' })
  ),
  transports: [
    // Console — colorized for dev
    new winston.transports.Console({
      format: combine(colorize(), logFormat),
    }),

    // File — JSON structured for production / audit
    new winston.transports.File({
      filename: path.resolve(__dirname, '..', '..', 'logs', 'gateway.log'),
      format: combine(logFormat),
      maxsize: 10 * 1024 * 1024, // 10 MB
      maxFiles: 5,
    }),

    // Separate error log
    new winston.transports.File({
      filename: path.resolve(__dirname, '..', '..', 'logs', 'error.log'),
      level: 'error',
      format: combine(logFormat),
      maxsize: 5 * 1024 * 1024,
      maxFiles: 3,
    }),
  ],
});

module.exports = logger;
