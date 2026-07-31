// src/socket/agentHandler.js
// Handle Agent WebSocket connections (raw-WS, already authenticated at handshake).
//
// Protocol:
//   Binary  → forward NGUYÊN Buffer tới MỌI controller (broadcast).
//   Text REGISTER → lưu store + broadcast agent_status online.
//   Text other    → CHÈN/GHI ĐÈ agent_id → broadcast JSON tới mọi controller.
//   Close         → removeByWs + broadcast agent_status offline.

const agentStore = require('../store/agentStore');
const controllerStore = require('../store/controllerStore');
const heartbeat = require('../store/heartbeat');
const logger = require('../utils/logger');

/**
 * Attach event handlers to an authenticated Agent WebSocket.
 * @param {WebSocket} ws - The Agent WebSocket (already upgraded & authenticated)
 * @param {import('http').IncomingMessage} req - The original HTTP upgrade request
 */
function handleAgent(ws, req) {
  const ip =
    req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';

  // This will be set after REGISTER
  let agentId = null;

  logger.info('[agent] New agent connection (awaiting REGISTER)', { ip });

  // Attach heartbeat
  const hb = heartbeat.attach(ws, `agent:${ip}`);

  // ─── message ─────────────────────────────────────────────────
  ws.on('message', (data, isBinary) => {
    // ── Binary frame → broadcast raw to all controllers ──────
    if (isBinary) {
      logger.debug('[agent] Binary frame relay', {
        agentId,
        bytes: data.length,
      });
      controllerStore.broadcast(data, { binary: true });
      return;
    }

    // ── Text frame → parse JSON ──────────────────────────────
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch (err) {
      logger.warn('[agent] Invalid JSON from agent', {
        agentId,
        ip,
        error: err.message,
        preview: data.toString().substring(0, 200),
      });
      return;
    }

    // ── REGISTER ─────────────────────────────────────────────
    if (msg.type === 'REGISTER') {
      agentId = msg.agent_id;

      if (!agentId) {
        logger.warn('[agent] REGISTER missing agent_id', { ip });
        return;
      }

      // Store in registry
      agentStore.register(agentId, ws, {
        hostname: msg.hostname || agentId,
        ip: msg.ip || ip,
        os: msg.os || 'unknown',
      });

      // Update heartbeat label now that we know the agentId
      hb.clear();
      const hb2 = heartbeat.attach(ws, `agent:${agentId}`);
      // Replace reference for cleanup on close
      ws._gwHeartbeat = hb2;

      logger.info('[agent] REGISTER', {
        agentId,
        hostname: msg.hostname,
        ip: msg.ip,
        os: msg.os,
      });

      // Broadcast agent_status online to all controllers
      const statusMsg = JSON.stringify({
        type: 'agent_status',
        agent_id: agentId,
        hostname: msg.hostname || agentId,
        ip: msg.ip || ip,
        os: msg.os || 'unknown',
        online: true,
      });
      controllerStore.broadcast(statusMsg);

      return;
    }

    // ── All other messages → stamp agent_id + broadcast ──────
    if (!agentId) {
      logger.warn('[agent] Message from unregistered agent, dropping', {
        ip,
        type: msg.type,
      });
      return;
    }

    // CHÈN/GHI ĐÈ agent_id
    msg.agent_id = agentId;

    logger.info('[agent→controller] Relay', {
      agentId,
      type: msg.type,
    });

    controllerStore.broadcast(JSON.stringify(msg));
  });

  // ─── close ───────────────────────────────────────────────────
  ws.on('close', (code, reason) => {
    // Clear heartbeat
    if (ws._gwHeartbeat) {
      ws._gwHeartbeat.clear();
    } else {
      hb.clear();
    }

    // Remove from store strictly by ws object (to avoid deleting new socket if reconnected quickly)
    const removedId = agentStore.removeByWs(ws);

    if (removedId) {
      logger.info('[agent] Disconnected', {
        agentId: removedId,
        code,
        reason: reason?.toString(),
      });

      // Broadcast agent_status offline to all controllers
      const statusMsg = JSON.stringify({
        type: 'agent_status',
        agent_id: removedId,
        online: false,
      });
      controllerStore.broadcast(statusMsg);
    } else {
      logger.info('[agent] Unregistered agent disconnected', { ip, code });
    }
  });

  // ─── error ───────────────────────────────────────────────────
  ws.on('error', (err) => {
    logger.error('[agent] WebSocket error', {
      agentId,
      ip,
      error: err.message,
    });
  });
}

module.exports = handleAgent;
