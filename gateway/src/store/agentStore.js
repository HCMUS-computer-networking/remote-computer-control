// src/store/agentStore.js
// Registry of connected Agent WebSocket clients.
// Key: agentId (string) → Value: { agentId, ws, hostname, ip, os, connectedAt }
//
// Credential verification: agents.json maps agent_id → secretHash (bcrypt).
// Duplicate rejection: if agent_id is already online, NEW connection is refused.

const path = require('path');
const bcrypt = require('bcryptjs');
const logger = require('../utils/logger');
const { queries } = require('../db');

/** @type {Map<string, {agentId: string, ws: WebSocket, hostname: string, ip: string, os: string, connectedAt: number}>} */
const agents = new Map();

/**
 * Verify an agent's secret against the stored bcrypt hash in SQLite database.
 * @param {string} agentId
 * @param {string} secret - Plaintext secret sent by the agent
 * @returns {Promise<boolean>} true if valid
 */
async function verifySecret(agentId, secret) {
  const agent = queries.getAgentById(agentId);
  if (!agent || !agent.secret_hash) {
    logger.warn('[agentStore] Unknown agent_id — not found in SQLite database', { agentId });
    return false;
  }
  return bcrypt.compare(secret, agent.secret_hash);
}

/**
 * Register an agent after it sends the REGISTER message.
 * If agent_id is already online → REJECT the new connection (return false).
 *
 * @param {string} agentId
 * @param {WebSocket} ws
 * @param {{ hostname: string, ip: string, os: string }} meta
 * @returns {boolean} true if registered, false if rejected (already online)
 */
function register(agentId, ws, meta) {
  // If an agent with the same id is already connected → REJECT the NEW socket
  if (agents.has(agentId)) {
    const existing = agents.get(agentId);
    if (existing.ws.readyState === existing.ws.OPEN) {
      logger.warn('[agentStore] Agent already online — rejecting NEW connection', {
        agentId,
      });
      return false; // Caller must close the NEW socket
    }
    // Existing socket is not OPEN (stale entry) — clean it up and allow
    agents.delete(agentId);
    logger.info('[agentStore] Cleaned stale entry for agent', { agentId });
  }

  agents.set(agentId, {
    agentId,
    ws,
    hostname: meta.hostname || agentId,
    ip: meta.ip || 'unknown',
    os: meta.os || 'unknown',
    connectedAt: Date.now(),
  });

  logger.info('[agentStore] Agent registered', {
    agentId,
    hostname: meta.hostname,
    ip: meta.ip,
    os: meta.os,
  });

  return true;
}

/**
 * Unregister an agent by its agentId.
 * @param {string} agentId
 * @returns {boolean} true if the agent was found and removed
 */
function unregister(agentId) {
  const removed = agents.delete(agentId);
  if (removed) {
    logger.info('[agentStore] Agent unregistered', { agentId });
  }
  return removed;
}

/**
 * Remove an agent by its WebSocket reference (used on 'close' event
 * when we only have the ws object, not the agentId).
 * @param {WebSocket} ws
 * @returns {string|null} the agentId that was removed, or null
 */
function removeByWs(ws) {
  for (const [agentId, entry] of agents) {
    if (entry.ws === ws) {
      agents.delete(agentId);
      logger.info('[agentStore] Agent removed by ws ref', { agentId });
      return agentId;
    }
  }
  return null;
}

/**
 * Lookup an agent entry by its WebSocket reference.
 * @param {WebSocket} ws
 * @returns {{ agentId: string, ws: WebSocket, hostname: string, ip: string, os: string, connectedAt: number }|null}
 */
function getByWs(ws) {
  for (const entry of agents.values()) {
    if (entry.ws === ws) {
      return entry;
    }
  }
  return null;
}

/**
 * Get the WebSocket for a specific agent.
 * @param {string} agentId
 * @returns {WebSocket|null}
 */
function getSocket(agentId) {
  const entry = agents.get(agentId);
  return entry ? entry.ws : null;
}

/**
 * Get a specific agent entry.
 * @param {string} agentId
 * @returns {{ agentId: string, ws: WebSocket, hostname: string, ip: string, os: string, connectedAt: number }|null}
 */
function get(agentId) {
  return agents.get(agentId) || null;
}

/**
 * Get all agents in the clean shape expected by Controller's agents_list.
 * Matches Controller Protocol.js normalizeAgent: { id, name, os, ip, online }
 * @returns {Array<{ id: string, name: string, os: string, ip: string, online: boolean }>}
 */
function getAll() {
  const list = [];
  for (const entry of agents.values()) {
    list.push({
      id: entry.agentId,
      name: entry.hostname, // name = hostname
      os: entry.os,
      ip: entry.ip,
      online: true, // Only connected agents are in the store
    });
  }
  return list;
}

/**
 * Get the number of connected agents.
 * @returns {number}
 */
function size() {
  return agents.size;
}

module.exports = {
  verifySecret,
  register,
  unregister,
  removeByWs,
  getByWs,
  getSocket,
  get,
  getAll,
  size,
};
