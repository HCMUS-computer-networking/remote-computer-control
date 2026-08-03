// src/socket/controllerHandler.js
// Handle Controller WebSocket connections (raw-WS, already authenticated at handshake).
//
// Protocol:
//   list_agents → respond directly from agentStore (KHÔNG xuống Agent).
//   Other messages with target_agents → forward NGUYÊN message tới ws của từng agent.
//   target_agents rỗng + policy_update → gửi cho TẤT CẢ agents.
//   Close → remove from controllerStore.

const agentStore = require('../store/agentStore');
const controllerStore = require('../store/controllerStore');
const heartbeat = require('../store/heartbeat');
const messageRouter = require('../router/messageRouter');
const logger = require('../utils/logger');

/** Simple incrementing ID for logging */
let controllerCounter = 0;

/**
 * Attach event handlers to an authenticated Controller WebSocket.
 * @param {WebSocket} ws - The Controller WebSocket (already upgraded & authenticated)
 * @param {import('http').IncomingMessage} req - The original HTTP upgrade request
 */
function handleController(ws, req) {
  const ip =
    req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  const controllerId = `ctrl-${++controllerCounter}`;
  const issuer = ws._gwJwtPayload?.username || controllerId;

  // Add to controller store
  controllerStore.add(ws);

  logger.info('[controller] Connected', { controllerId, ip, issuer });

  // Attach heartbeat
  const hb = heartbeat.attach(ws, `controller:${controllerId}`);

  // ─── message ─────────────────────────────────────────────────
  ws.on('message', (data, isBinary) => {
    // Controllers should not send binary — ignore if they do
    if (isBinary) {
      logger.warn('[controller] Unexpected binary from controller, ignoring', {
        controllerId,
        bytes: data.length,
      });
      return;
    }

    // ── Parse JSON ───────────────────────────────────────────
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch (err) {
      logger.warn('[controller] Invalid JSON', {
        controllerId,
        error: err.message,
        preview: data.toString().substring(0, 200),
      });
      return;
    }

    // ── list_agents → respond directly (không xuống Agent) ───
    if (msg.type === 'list_agents') {
      const agents = agentStore.getAll();
      const response = JSON.stringify({
        type: 'agents_list',
        agents,
      });

      logger.info('[controller] list_agents request', {
        controllerId,
        agentCount: agents.length,
      });

      controllerStore.sendTo(ws, response);
      return;
    }

    // ── subscribe / unsubscribe → handle directly (không xuống Agent) ───
    if (msg.type === 'subscribe') {
      if (msg.agent_id && typeof msg.agent_id === 'string') {
        controllerStore.subscribe(ws, msg.agent_id);
        logger.info('[controller] Subscribed to agent', { controllerId, agentId: msg.agent_id });
      } else {
        logger.warn('[controller] subscribe missing agent_id', { controllerId });
      }
      return;
    }

    if (msg.type === 'unsubscribe') {
      if (msg.agent_id && typeof msg.agent_id === 'string') {
        controllerStore.unsubscribe(ws, msg.agent_id);
        logger.info('[controller] Unsubscribed from agent', { controllerId, agentId: msg.agent_id });
      } else {
        logger.warn('[controller] unsubscribe missing agent_id', { controllerId });
      }
      return;
    }

    // ── Whitelist of relay-able types ─────────────────────────────
    const RELAY_TYPES = new Set([
      'request',
      'power',
      'policy_update',
      'permission_request',
      'permission_revoke',
      'stop_module',
    ]);

    if (!RELAY_TYPES.has(msg.type)) {
      logger.warn('[controller] Unknown controller message type, dropping', {
        controllerId,
        type: msg.type,
      });
      return;
    }

    // ── Relay to agent(s) ────────────────────────────────────────
    logger.info('[controller→agent] Relay', {
      controllerId,
      issuer,
      type: msg.type,
      module: msg.module,
      targetAgents: msg.target_agents,
    });

    messageRouter.routeToAgents(data.toString(), msg, issuer, ws);
  });

  // ─── close ───────────────────────────────────────────────────
  ws.on('close', (code, reason) => {
    hb.clear();
    controllerStore.remove(ws);

    logger.info('[controller] Disconnected', {
      controllerId,
      code,
      reason: reason?.toString(),
      ip,
    });
  });

  // ─── error ───────────────────────────────────────────────────
  ws.on('error', (err) => {
    logger.error('[controller] WebSocket error', {
      controllerId,
      ip,
      error: err.message,
    });
  });
}

module.exports = handleController;
