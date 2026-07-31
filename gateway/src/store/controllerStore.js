// src/managers/controllerStore.js
// Set of connected Controller WebSocket clients.
// Provides add/remove/broadcast for relaying Agent messages to all Controllers.

const logger = require('../utils/logger');

/** @type {Set<WebSocket>} */
const controllers = new Set();

/**
 * Add a Controller WebSocket to the set.
 * @param {WebSocket} ws
 */
function add(ws) {
  controllers.add(ws);
  logger.info('[controllerStore] Controller added', {
    total: controllers.size,
  });
}

/**
 * Remove a Controller WebSocket from the set.
 * @param {WebSocket} ws
 */
function remove(ws) {
  controllers.delete(ws);
  logger.info('[controllerStore] Controller removed', {
    total: controllers.size,
  });
}

/**
 * Broadcast data (text or binary) to ALL connected Controllers.
 * Wraps each send in try-catch to avoid crash if one controller disconnected.
 * @param {string|Buffer} data - text string or binary buffer
 * @param {{ binary?: boolean }} [options] - pass { binary: true } for binary frames
 */
function broadcast(data, options = {}) {
  const isBinary = options.binary || false;

  for (const ws of controllers) {
    try {
      if (ws.readyState === ws.OPEN) {
        ws.send(data, { binary: isBinary });
      }
    } catch (err) {
      logger.error('[controllerStore] Broadcast send error', {
        error: err.message,
      });
    }
  }
}

/**
 * Send data to a single Controller WebSocket.
 * @param {WebSocket} ws
 * @param {string|Buffer} data
 */
function sendTo(ws, data) {
  try {
    if (ws.readyState === ws.OPEN) {
      ws.send(data);
    }
  } catch (err) {
    logger.error('[controllerStore] sendTo error', { error: err.message });
  }
}

/**
 * Get all connected Controller WebSockets.
 * @returns {Set<WebSocket>}
 */
function getAll() {
  return controllers;
}

/**
 * Get the number of connected controllers.
 * @returns {number}
 */
function size() {
  return controllers.size;
}

module.exports = {
  add,
  remove,
  broadcast,
  sendTo,
  getAll,
  size,
};
