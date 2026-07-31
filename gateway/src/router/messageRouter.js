// src/router/messageRouter.js
// Route Controller messages to Agent(s) based on target_agents field.
//
// Protocol (D3):
//   - Read target_agents (array of agent_id).
//   - Forward NGUYÊN message (raw string) tới ws của từng agent.
//   - target_agents rỗng + type contains policy_update → gửi TẤT CẢ agents.
//   - target_agents rỗng + other types → log warning, skip.

const agentStore = require('../store/agentStore');
const logger = require('../utils/logger');

/**
 * Route a Controller message to the appropriate Agent(s).
 * Forwards the RAW message string — gateway does NOT modify content.
 *
 * @param {string} rawMessage - The original JSON string from Controller
 * @param {object} parsed - The already-parsed message object (to avoid double-parse)
 */
function routeToAgents(rawMessage, parsed) {
  const targetAgents = parsed.target_agents;
  const msgType = parsed.type || 'unknown';
  const msgModule = parsed.module || '';

  // ── target_agents is a non-empty array → send to specific agents ──
  if (Array.isArray(targetAgents) && targetAgents.length > 0) {
    for (const agentId of targetAgents) {
      const agentWs = agentStore.getSocket(agentId);

      if (!agentWs || agentWs.readyState !== agentWs.OPEN) {
        logger.warn('[router] Target agent not found or not connected', {
          agentId,
          type: msgType,
          module: msgModule,
        });
        continue;
      }

      try {
        agentWs.send(rawMessage);
        logger.debug('[router] Forwarded to agent', {
          agentId,
          type: msgType,
          module: msgModule,
        });
      } catch (err) {
        logger.error('[router] Failed to send to agent', {
          agentId,
          error: err.message,
        });
      }
    }
    return;
  }

  // ── target_agents empty/missing → broadcast to ALL agents ──────
  // resolveTargets: rỗng = tất cả agent (chủ yếu cho policy_update,
  // nhưng áp dụng cho mọi type hợp lệ đã qua whitelist ở controllerHandler)
  const allAgents = agentStore.getAll();

  if (allAgents.length === 0) {
    logger.warn('[router] No agents connected, cannot relay', {
      type: msgType,
      module: msgModule,
    });
    return;
  }

  logger.info('[router] Broadcasting to all agents (empty target_agents)', {
    type: msgType,
    module: msgModule,
    count: allAgents.length,
  });

  for (const agent of allAgents) {
    const agentWs = agentStore.getSocket(agent.id);
    if (agentWs && agentWs.readyState === agentWs.OPEN) {
      try {
        agentWs.send(rawMessage);
      } catch (err) {
        logger.error('[router] Failed to broadcast to agent', {
          agentId: agent.id,
          error: err.message,
        });
      }
    }
  }
}

module.exports = { routeToAgents };
