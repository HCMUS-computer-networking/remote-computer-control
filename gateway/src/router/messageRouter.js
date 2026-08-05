// src/router/messageRouter.js
// Route Controller messages to Agent(s) based on target_agents field.
//
// Protocol (D3 / Security Hardening / Envelope Validation):
//   - Parse & validate JSON message (reject if invalid JSON — G7 prep).
//   - Validate minimal TX envelope via Ajv schema (type, module/action, target_agents).
//   - Whitelist allowed modules based on formatjson specifications.
//   - If invalid -> ACK error to Controller, DO NOT forward.
//   - Inject top-level `issuer` field (string username from Controller session).
//   - Re-serialize JSON string and forward to agent(s).

const Ajv = require('ajv');
const agentStore = require('../store/agentStore');
const controllerStore = require('../store/controllerStore');
const logger = require('../utils/logger');
const { validateParams } = require('../validation/commandSchemas');


const ajv = new Ajv({ allErrors: true });

// ─── Module Whitelist (from ../../docs/protocol/*.json + power/policy specs) ───
const VALID_MODULES = [
  'app_list',
  'app_start',
  'app_stop',
  'proc_list',
  'proc_kill',
  'screenshot',
  'screen_stream',
  'screen_stream_stop',
  'keylog_start',
  'keylog_stop',
  'fs_list',
  'fs_get',
  'fs_put',
  'fs_delete',
  'webcam_start',
  'webcam_stop',
  'sysinfo',
  // Additional valid commands defined in ../../docs/protocol/ and RELAY_TYPES
  'power_lock',
  'power_restart',
  'power_shutdown',
  'power_sleep',
  'policy_update',
  'permission_request',
  'permission_revoke',
  'permissions_reset',
  'stop_module',
  'e2ee_init',
  'e2ee_payload',
  'input_mouse_move',
  'input_mouse_click',
  'input_key',
  'input_type',
];

// ─── Minimal Envelope Schema ──────────────────────────────────────────
// Required: type (string), target_agents (array of string), and at least module OR action.
const envelopeSchema = {
  type: 'object',
  required: ['type', 'target_agents'],
  anyOf: [
    { required: ['module'] },
    { required: ['action'] },
    { required: ['feature'] },
    { required: ['params'] },
  ],
  properties: {
    type: { type: 'string' },
    module: { type: 'string', enum: VALID_MODULES },
    action: { type: 'string' },
    target_agents: {
      type: 'array',
      items: { type: 'string' },
    },
  },
};

const validateEnvelope = ajv.compile(envelopeSchema);

/**
 * Route a Controller message to the appropriate Agent(s).
 * Validates JSON and envelope schema, stamps top-level `issuer` field, re-serializes and sends.
 *
 * @param {string} rawMessage - The original JSON string from Controller
 * @param {object|null} parsed - The already-parsed message object (to avoid double-parse if valid)
 * @param {string} [issuer="admin"] - The username of the Controller issuing the message
 * @param {WebSocket|null} [controllerWs=null] - Reference to Controller websocket to send ACK errors
 * @returns {boolean} true if message was processed, false if rejected
 */
function routeToAgents(rawMessage, parsed, issuer = 'admin', controllerWs = null) {
  // 3. Nếu message không phải JSON hợp lệ → reject, KHÔNG forward (chuẩn bị cho G7 input validation)
  let msgObj = parsed;
  if (!msgObj) {
    try {
      msgObj = JSON.parse(rawMessage);
    } catch (err) {
      logger.warn('[router] Rejected relay: invalid JSON', { error: err.message });
      if (controllerWs && controllerWs.readyState === controllerWs.OPEN) {
        controllerWs.send(JSON.stringify({ type: 'error_ack', error: 'Invalid JSON', details: err.message }));
      }
      return false;
    }
  }

  if (typeof msgObj !== 'object' || msgObj === null || Array.isArray(msgObj)) {
    logger.warn('[router] Rejected relay: JSON payload must be a valid object');
    if (controllerWs && controllerWs.readyState === controllerWs.OPEN) {
      controllerWs.send(JSON.stringify({ type: 'error_ack', error: 'Payload must be a JSON object' }));
    }
    return false;
  }

  // ── Validate envelope against minimal schema + module whitelist ─────
  let valid = true;
  if (msgObj.type !== 'e2ee_init' && msgObj.type !== 'e2ee_payload') {
    valid = validateEnvelope(msgObj);
  }
  
  if (!valid) {
    logger.warn('[router] Message failed envelope schema validation', {
      errors: validateEnvelope.errors,
      type: msgObj.type,
      module: msgObj.module,
    });
    if (controllerWs && controllerWs.readyState === controllerWs.OPEN) {
      controllerWs.send(
        JSON.stringify({
          type: 'error_ack',
          success: false,
          error: 'Envelope validation failed: invalid schema or module not whitelisted',
          details: validateEnvelope.errors,
          original_type: msgObj.type || 'unknown',
        })
      );
    }
    return false;
  }

  // ── Validate specific params deep schema ─────────────────────────────
  const commandKey = msgObj.action || msgObj.module || msgObj.type;
  if (commandKey) {
    const paramsValidResult = validateParams(commandKey, msgObj.params);
    if (!paramsValidResult.valid) {
      logger.warn('[router] Message failed deep params schema validation', {
        errorText: paramsValidResult.errorText,
        type: msgObj.type,
        commandKey,
      });
      if (controllerWs && controllerWs.readyState === controllerWs.OPEN) {
        controllerWs.send(
          JSON.stringify({
            type: 'ERROR',
            command_id: msgObj.command_id || null,
            message: `Input validation failed for params: ${paramsValidResult.errorText}`,
            details: paramsValidResult.errors
          })
        );
      }
      return false;
    }
  }

  // ── Role-based Access Control (RBAC) check ─────────────────────────
  // admin: allowed to send commands down to Agents
  // viewer: read-only (can only view agent list and receive streams via subscribe, cannot forward commands)
  const userRole = controllerWs ? (controllerWs._gwUserRole || controllerWs._gwJwtPayload?.role) : 'admin';
  if (userRole !== 'admin') {
    logger.warn('[router] Rejected relay: controller role "viewer" is read-only and cannot execute commands on agents', {
      issuer,
      role: userRole,
      type: msgObj?.type,
      module: msgObj?.module,
    });
    if (controllerWs && controllerWs.readyState === controllerWs.OPEN) {
      controllerWs.send(
        JSON.stringify({
          type: 'error_ack',
          success: false,
          error: 'Permission denied: role "viewer" is read-only and cannot execute commands on agents',
          code: 403,
        })
      );
    }
    return false;
  }

  // 1. Thêm field top-level `issuer` là string username (đơn giản — không dùng object)
  msgObj.issuer = String(issuer || 'admin');

  // Register command ID or req_id so responses from Agent can be routed directly back to this Controller
  const reqId = msgObj.command_id || msgObj.req_id || msgObj.id;
  if (reqId && typeof reqId === 'string' && controllerWs) {
    controllerStore.registerCommand(reqId, controllerWs);
  }

  // 2. Serialize lại trước khi gửi
  const forwardMessage = JSON.stringify(msgObj);

  const targetAgents = msgObj.target_agents;
  const msgType = msgObj.type || 'unknown';
  const msgModule = msgObj.module || '';

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
        agentWs.send(forwardMessage);
        logger.debug('[router] Forwarded to agent', {
          agentId,
          issuer: msgObj.issuer,
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
    return true;
  }

  // ── target_agents empty/missing ──
  // Broadcast is ONLY allowed for policy_update (fleet-wide push semantics).
  // Every other command must name explicit targets to avoid accidental
  // fleet-wide power_shutdown / restart / sleep / keylog_start etc.
  if (msgType !== 'policy_update')
  {
    logger.warn('[router] Rejected relay: target_agents is required for non-broadcast commands', {
      issuer: msgObj.issuer,                                                                        //
      type: msgType,                                                                                //
      module: msgModule,                                                                            //
    });
    if (controllerWs && controllerWs.readyState === controllerWs.OPEN)
    {
      controllerWs.send(
        JSON.stringify({
          type: 'error_ack',
          success: false,
          error: 'target_agents is required for non-broadcast commands',
          original_type: msgType,
          command_id: msgObj.command_id || null,
          code: 400,
        })
      );
    }
    return false;
  }

  const allAgents = agentStore.getAll();

  if (allAgents.length === 0) {
    logger.warn('[router] No agents connected, cannot relay', {
      type: msgType,
      module: msgModule,
    });
    return true;
  }

  logger.info('[router] Broadcasting to all agents (empty target_agents)', {
    issuer: msgObj.issuer,
    type: msgType,
    module: msgModule,
    count: allAgents.length,
  });

  for (const agent of allAgents) {
    const agentWs = agentStore.getSocket(agent.id);
    if (agentWs && agentWs.readyState === agentWs.OPEN) {
      try {
        agentWs.send(forwardMessage);
      } catch (err) {
        logger.error('[router] Failed to broadcast to agent', {
          agentId: agent.id,
          error: err.message,
        });
      }
    }
  }

  return true;
}

module.exports = { routeToAgents, validateEnvelope, VALID_MODULES };
