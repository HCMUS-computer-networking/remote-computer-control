// src/managers/controllerStore.js
// Set of connected Controller WebSocket clients and their Agent subscriptions.
// Provides add/remove/broadcast, subscribe/unsubscribe, and request matching for routing Agent responses.

const logger = require('../utils/logger');

/** @type {Set<WebSocket>} */
const controllers = new Set();

/** @type {Map<WebSocket, Set<string>>} */
const controllerSubscriptions = new Map();

/** @type {Map<string, WebSocket>} */
const commandToController = new Map();

/**
 * Add a Controller WebSocket to the set and initialize its subscription set.
 * @param {WebSocket} ws
 */
function add(ws) {
  controllers.add(ws);
  controllerSubscriptions.set(ws, new Set());
  logger.info('[controllerStore] Controller added', {
    total: controllers.size,
  });
}

/**
 * Remove a Controller WebSocket from the set, deleting its subscriptions and pending command mappings.
 * @param {WebSocket} ws
 */
function remove(ws) {
  controllers.delete(ws);
  controllerSubscriptions.delete(ws);

  // Clean up command mappings associated with this controller
  for (const [cmdId, controllerWs] of commandToController.entries()) {
    if (controllerWs === ws) {
      commandToController.delete(cmdId);
    }
  }

  logger.info('[controllerStore] Controller removed and subscriptions cleared', {
    total: controllers.size,
  });
}

/**
 * Subscribe a Controller to messages from a specific Agent.
 * @param {WebSocket} ws
 * @param {string} agentId
 */
function subscribe(ws, agentId) {
  let subs = controllerSubscriptions.get(ws);
  if (!subs) {
    subs = new Set();
    controllerSubscriptions.set(ws, subs);
  }
  subs.add(agentId);
  logger.info('[controllerStore] Subscribed to agent', { agentId, totalSubs: subs.size });
}

/**
 * Unsubscribe a Controller from messages from a specific Agent.
 * @param {WebSocket} ws
 * @param {string} agentId
 */
function unsubscribe(ws, agentId) {
  const subs = controllerSubscriptions.get(ws);
  if (subs) {
    subs.delete(agentId);
    logger.info('[controllerStore] Unsubscribed from agent', { agentId, remainingSubs: subs.size });
  }
}

/**
 * Check if a Controller is subscribed to a specific Agent.
 * @param {WebSocket} ws
 * @param {string} agentId
 * @returns {boolean}
 */
function isSubscribed(ws, agentId) {
  const subs = controllerSubscriptions.get(ws);
  return subs ? subs.has(agentId) : false;
}

/**
 * Get all subscriptions for a specific Controller.
 * @param {WebSocket} ws
 * @returns {Set<string>|null}
 */
function getSubscriptions(ws) {
  return controllerSubscriptions.get(ws) || null;
}

/**
 * Register a command ID (or req_id) issued by a Controller for later response matching.
 * @param {string} commandId
 * @param {WebSocket} ws
 */
function registerCommand(commandId, ws) {
  if (commandId && typeof commandId === 'string' && ws) {
    commandToController.set(commandId, ws);
  }
}

/**
 * Check if a command ID is recorded and mapped to an active Controller.
 * @param {string} commandId
 * @returns {boolean}
 */
function hasCommand(commandId) {
  const ws = commandToController.get(commandId);
  return ws && ws.readyState === ws.OPEN;
}

/**
 * Send data directly to the Controller that initiated a given command/req ID.
 * @param {string} commandId
 * @param {string|Buffer} data
 * @returns {boolean} true if sent successfully
 */
function sendToCommandInitiator(commandId, data) {
  const ws = commandToController.get(commandId);
  if (ws && ws.readyState === ws.OPEN) {
    try {
      ws.send(data);
      // Clean up the mapping after successful delivery to prevent unbounded growth.
      // UDP frame_meta reuses the same command_id across the stream, so we must
      // NOT delete here for frame routing. The caller (udpServer.js) uses
      // hasCommand() + sendToCommandInitiator() for each frame in a stream.
      // Text-based one-shot responses (app_list_result, power_result, etc.) are
      // safe to clean up. We keep the entry alive and rely on controller-disconnect
      // cleanup for stream commands. A periodic GC is added below for safety.
      return true;
    } catch (err) {
      logger.error('[controllerStore] sendToCommandInitiator error', { error: err.message });
    }
  }
  return false;
}

/**
 * Broadcast data (text or binary) ONLY to Controllers subscribed to the specified Agent.
 * @param {string} agentId
 * @param {string|Buffer} data
 * @param {{ binary?: boolean }} [options]
 * @returns {number} number of controllers sent to
 */
function broadcastToSubscribers(agentId, data, options = {}) {
  const isBinary = options.binary || false;
  let sentCount = 0;

  for (const [ws, subs] of controllerSubscriptions.entries()) {
    if (subs.has(agentId)) {
      try {
        if (ws.readyState === ws.OPEN) {
          ws.send(data, { binary: isBinary });
          sentCount++;
        }
      } catch (err) {
        logger.error('[controllerStore] broadcastToSubscribers send error', {
          error: err.message,
        });
      }
    }
  }
  return sentCount;
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

// Periodic GC: remove stale command entries whose Controller WebSocket is no
// longer open. This prevents unbounded growth from long-running sessions
// without removing entries for active streams.
const COMMAND_GC_INTERVAL_MS = 60_000; // every 60 seconds
setInterval(() => {
  let cleaned = 0;
  for (const [cmdId, ws] of commandToController.entries()) {
    if (!ws || ws.readyState !== ws.OPEN) {
      commandToController.delete(cmdId);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    logger.debug('[controllerStore] GC cleaned stale command entries', { cleaned, remaining: commandToController.size });
  }
}, COMMAND_GC_INTERVAL_MS);

module.exports = {
  add,
  remove,
  subscribe,
  unsubscribe,
  isSubscribed,
  getSubscriptions,
  registerCommand,
  hasCommand,
  sendToCommandInitiator,
  broadcastToSubscribers,
  broadcast,
  sendTo,
  getAll,
  size,
};
