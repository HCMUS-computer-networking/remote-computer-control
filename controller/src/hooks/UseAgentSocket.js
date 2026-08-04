// UseAgentSocket.js — sole glue layer between the socket service and Zustand stores.
//
// Components must NEVER import MockSocket or Socket directly; they use this hook.
// Swapping MockSocket for the real Socket only requires changing the one import below.
//
// SINGLETON PATTERN — ref-counted so multiple components can call useAgentSocket()
// without opening extra WebSocket connections.
// The socket is created when the first caller mounts (refcount 0 → 1) and closed
// when the last caller unmounts (refcount 1 → 0, i.e. the whole app tears down).
//
// TARGETING — the hook returns three send helpers:
//   sendCommand(json)     — raw: sends the JSON string as-is (for list_agents, power, etc.)
//   sendToFocused(json)   — auto-injects [focused_agent_id] into target_agents
//                           before sending. Used by module tabs in FocusView.
//   sendToSelected(json)  — auto-injects selected_agent_ids into target_agents
//                           before sending. Used for batch commands.
//
// BINARY FRAME DISPATCH — screen/webcam JPEG frames arrive as two consecutive
// messages: a JSON frame_meta followed by a raw ArrayBuffer. We hold the most
// recent frame_meta in _pending_meta. When a binary message arrives we pair it
// with _pending_meta and push the complete frame into ModuleStore.
//
// RX DISPATCH — every incoming message is routed by its "type" field to the
// correct Zustand store action. See the dispatchMessage() function at the bottom
// for the full routing table.

import { useEffect } from 'react'

import AgentSocket                       from '../services'   // mock or real, chosen by VITE_USE_MOCK in services/index.js
import { buildListAgents, buildPolicyUpdate, buildPermissionRequest, buildPermissionRevoke, buildStopModule, normalizeIncoming, MSG_TYPE, MODULE, FEATURE } from '../services/Protocol'
import { refreshAccessToken, logout }    from '../services/AuthService'
import useE2EEStore                      from '../store/E2EEStore'
import { generateECDHKeyPair, exportPublicKeyToSPKI, signHMAC, importPublicKeyFromSPKI, verifyHMAC, deriveSessionKey, encryptAESGCM, decryptAESGCM, generateIV, arrayBufferToBase64, base64ToArrayBuffer } from '../utils/crypto'

// Modules that only make sense against ONE agent at a time (the operator is
// watching a single feed). sendCommand routes these to focused_agent_id even
// when a multi-select set is present, so a Live-Screen click never floods
// every selected agent with a stream request.
const FRAME_FOCUS_MODULES = new Set([
    MODULE.SCREENSHOT,
    MODULE.SCREEN_STREAM,
    MODULE.SCREEN_STREAM_STOP,
    MODULE.WEBCAM_START,
    MODULE.WEBCAM_STOP,
])

// Map every module command name to the FEATURE it needs consent for. Plan B
// only sends a module command to an agent that already granted this feature.
// "power" messages are mapped separately (they use a top-level "power" type,
// not a "module" field) — see featureForMessage below.
const MODULE_FEATURE = {
    [MODULE.APP_LIST]           : FEATURE.APPLICATION,
    [MODULE.APP_START]          : FEATURE.APPLICATION,
    [MODULE.APP_STOP]           : FEATURE.APPLICATION,
    [MODULE.PROC_LIST]          : FEATURE.PROCESS,
    [MODULE.PROC_KILL]          : FEATURE.PROCESS,
    [MODULE.SCREENSHOT]         : FEATURE.SCREEN,
    [MODULE.SCREEN_STREAM]      : FEATURE.SCREEN,
    [MODULE.SCREEN_STREAM_STOP] : FEATURE.SCREEN,
    [MODULE.KEYLOG_START]       : FEATURE.KEYLOG,
    [MODULE.KEYLOG_STOP]        : FEATURE.KEYLOG,
    [MODULE.FS_LIST]            : FEATURE.FILE,
    [MODULE.FS_GET]             : FEATURE.FILE,
    [MODULE.FS_PUT]             : FEATURE.FILE,
    [MODULE.WEBCAM_START]       : FEATURE.WEBCAM,
    [MODULE.WEBCAM_STOP]        : FEATURE.WEBCAM,
    // Remote Input — 4 commands share ONE feature "input" (not "screen") so                       //
    // the operator must obtain a dedicated consent grant before driving the                       //
    // Agent's mouse or keyboard.                                                                  //
    'input_mouse_move'          : FEATURE.INPUT,
    'input_mouse_click'         : FEATURE.INPUT,
    'input_key'                 : FEATURE.INPUT,
    'input_type'                : FEATURE.INPUT,
}

// Return the FEATURE a message needs consent for, or null when it needs none
// (e.g. list_agents). Power uses its own top-level type; every request maps by
// its module field.
function featureForMessage(msg)
{
    if (msg.type === MSG_TYPE.POWER)   return FEATURE.POWER
    if (msg.type === MSG_TYPE.REQUEST) return MODULE_FEATURE[msg.module] ?? null
    return null
}
import useConnectionStore                from '../store/ConnectionStore'
import useAgentStore                     from '../store/AgentStore'
import useModuleStore                    from '../store/ModuleStore'
import useUiStore                        from '../store/UiStore'
import usePolicyStore                    from '../store/PolicyStore'
import usePermissionStore                from '../store/PermissionStore'

// ── Singleton state (module-level, shared across all hook invocations) ────────

let _socket           = null   // the one shared socket instance
let _refcount         = 0      // how many mounted components hold a reference
let _pending_meta     = null   // last frame_meta awaiting its binary companion
let _pending_fs_chunks = new Map()   // fs_get_result (binary mode) awaiting bytes, keyed by transfer_id — Map preserves insertion order for FIFO pairing when multiple downloads run in parallel
const _pendingE2EEKeys = new Map()   // agent_id -> privateKey (temporary during handshake)

// ── E2EE Handshake Init ───────────────────────────────────────────────────────
async function initE2EE(agent_id, socket) {
    const e2eeStore = useE2EEStore.getState()
    if (!e2eeStore.isUnlocked) return
    const pin = await e2eeStore.getAgentPin(agent_id)
    if (!pin) {
        console.warn(`[E2EE] No PIN saved for agent ${agent_id}. Cannot init handshake.`)
        return
    }

    try {
        e2eeStore.setSessionState(agent_id, 'handshaking')
        const keyPair = await generateECDHKeyPair()
        const pubKeyBase64 = await exportPublicKeyToSPKI(keyPair.publicKey)
        const signatureBase64 = await signHMAC(pubKeyBase64, pin)

        _pendingE2EEKeys.set(agent_id, keyPair.privateKey)

        const initMsg = {
            type: MSG_TYPE.E2EE_INIT,
            target_agents: [agent_id],
            publicKey: pubKeyBase64,
            signature: signatureBase64
        }
        if (socket) socket.send(JSON.stringify(initMsg))
    } catch (err) {
        console.error(`[E2EE] Handshake init failed for ${agent_id}`, err)
    }
}

async function handleE2EEPayload(msg) {
    const sessionKey = useE2EEStore.getState().getSessionKey(msg.agent_id)
    if (!sessionKey) {
        console.error(`[E2EE] Received payload from ${msg.agent_id} but no session key!`)
        return null
    }
    
    if (!useE2EEStore.getState().checkAndUpdateRecvSeq(msg.agent_id, msg.seq)) {
        console.error(`[E2EE] Sequence attack / drift from ${msg.agent_id}, seq: ${msg.seq}`)
        return null
    }

    try {
        const combined = new Uint8Array(base64ToArrayBuffer(msg.data))
        const iv = combined.slice(0, 12)
        const dataToDecrypt = combined.slice(12)
        const decryptedBuffer = await decryptAESGCM(sessionKey, dataToDecrypt, iv)
        const jsonStr = new TextDecoder().decode(decryptedBuffer)
        
        return normalizeIncoming(JSON.parse(jsonStr))
    } catch (e) {
        console.error(`[E2EE] Decryption failed for ${msg.agent_id}`, e)
        return null
    }
}

// ─────────────────────────────────────────────────────────────────────────────

export default function useAgentSocket()
{
    // Read store actions directly via getState() instead of hook selectors.
    // Actions are stable function refs that never change, so we do not need
    // to subscribe to the stores here — we only call the actions inside
    // socket callbacks which run outside the React render cycle anyway.
    // This also keeps the hook count constant (only 1 useEffect below),
    // which avoids HMR hook-order mismatches during development.
    const setStatus        = useConnectionStore.getState().setStatus
    const setAgents        = useAgentStore.getState().setAgents
    const setAgentStatus   = useAgentStore.getState().setAgentStatus
    const setModuleData    = useModuleStore.getState().setModuleData
    const appendKeylog     = useModuleStore.getState().appendKeylog
    const appendSysInfo    = useModuleStore.getState().appendSysInfo
    const setKeylogActive   = useModuleStore.getState().setKeylogActive
    const setWebcamActive   = useModuleStore.getState().setWebcamActive
    const setScreenStreamActive = useModuleStore.getState().setScreenStreamActive
    const setInputActive        = useModuleStore.getState().setInputActive
    const setFsEntries      = useModuleStore.getState().setFsEntries
    const appendFileDownloadChunk = useModuleStore.getState().appendFileDownloadChunk
    const setFilePutAck     = useModuleStore.getState().setFilePutAck
    const setPolicyResult   = usePolicyStore.getState().setPolicyResult
    const setPermissionResult = usePermissionStore.getState().setPermissionResult
    const addToast          = useUiStore.getState().addToast

    // ── Lifecycle: create / destroy the shared socket ─────────────────────
    useEffect(function ()
    {
        _refcount++

        // First caller creates the socket; later callers just bump the count.
        if (_socket === null)
        {
            const socket = new AgentSocket()
            _socket      = socket

            socket.onOpen(function ()
            {
                setStatus('open')
                socket.send(buildListAgents())   // request agent list right away

                // Push the security policy (app_whitelist + sandbox_path) to every
                // agent on connect. Empty target_agents = all agents. The Agent
                // overrides its local config in RAM and replies policy_update_result.
                const policy = usePolicyStore.getState()
                socket.send(buildPolicyUpdate(policy.app_whitelist, policy.sandbox_path, []))
            })

            socket.onMessage(function (raw_msg)
            {
                // Normalize the real Gateway/Agent JSON into our canonical shape
                // first, so dispatchMessage + stores stay unchanged. Mock messages
                // are already canonical and pass through untouched.
                const msg = normalizeIncoming(raw_msg)

                if (msg.type === MSG_TYPE.E2EE_PAYLOAD) {
                    handleE2EEPayload(msg).then(decryptedMsg => {
                        if (decryptedMsg) {
                            dispatchMessage(decryptedMsg, { setStatus, setAgents, setAgentStatus, setModuleData, appendKeylog, appendSysInfo, setKeylogActive, setWebcamActive, setScreenStreamActive, setInputActive, setFsEntries, appendFileDownloadChunk,setFilePutAck, setPolicyResult, setPermissionResult, addToast })
                        }
                    })
                    return
                }

                dispatchMessage(msg, { setStatus, setAgents, setAgentStatus, setModuleData, appendKeylog, appendSysInfo, setKeylogActive, setWebcamActive, setScreenStreamActive, setInputActive, setFsEntries, appendFileDownloadChunk,setFilePutAck, setPolicyResult, setPermissionResult, addToast })
            })

            // Binary callback — pair incoming ArrayBuffer with the pending frame_meta.
            // This runs immediately after the frame_meta JSON callback above,
            // so _pending_meta is guaranteed to be the matching header.
            socket.onBinary(async function (buffer)
            {
                // File-transfer binary chunk takes priority: fs_get_result is
                // request-driven and always paired 1:1 with the next binary,
                // whereas frame_meta belongs to a continuous stream.
                if (_pending_fs_chunks.size > 0)
                {
                    // FIFO pairing: pop the OLDEST pending meta
                    const first_key = _pending_fs_chunks.keys().next().value
                    const meta      = _pending_fs_chunks.get(first_key)
                    _pending_fs_chunks.delete(first_key)
                    appendFileDownloadChunk(meta.agent_id,
                    {
                        transfer_id  : meta.transfer_id,
                        chunk_index  : meta.chunk_index,
                        total_chunks : meta.total_chunks,
                        path         : meta.path,
                        total_size   : meta.total_size,
                        bytes        : new Uint8Array(buffer),
                    })
                    return
                }

                if (!_pending_meta)
                {
                    console.warn('[useAgentSocket] binary arrived without pending frame_meta / fs_chunks — dropped')
                    return
                }

                const meta      = _pending_meta
                _pending_meta   = null            // consume the pending meta

                // Sanity check
                if (meta.len != null && meta.len !== buffer.byteLength)
                {
                    console.warn(
                        `[useAgentSocket] frame length mismatch for ${meta.agent_id}/${meta.module}: ` +
                        `meta.len=${meta.len} but buffer=${buffer.byteLength} bytes — possible mis-pairing`
                    )
                }

                // Route to the correct module slot (screen or webcam)
                const module_key = meta.module    // "screen" or "webcam"
                
                // E2EE Decryption for UDP Stream
                const sessionKey = useE2EEStore.getState().getSessionKey(meta.agent_id);
                if (sessionKey) {
                    try {
                        const combined = new Uint8Array(buffer);
                        const iv = combined.slice(0, 12);
                        const dataToDecrypt = combined.slice(12);

                        // AAD = FrameId (2 bytes) + TimestampMs (8 bytes)
                        const aad = new ArrayBuffer(10);
                        const view = new DataView(aad);
                        view.setUint16(0, meta.seq, true);
                        view.setBigUint64(2, BigInt(meta.timestamp_ms), true);
                        
                        const decryptedBuffer = await decryptAESGCM(sessionKey, dataToDecrypt, iv, new Uint8Array(aad));
                        setModuleData(meta.agent_id, module_key, { frame: decryptedBuffer, meta });
                    } catch (e) {
                        console.error(`[E2EE] Failed to decrypt UDP stream from ${meta.agent_id}`, e);
                    }
                } else {
                    setModuleData(meta.agent_id, module_key, { frame: buffer, meta });
                }
            })

            // Drop any half-received frame_meta so the next reconnect's first
            // binary cannot pair with a stale header from a prior session.
            // Also reset every LIVE / CAM ON / KEYLOG indicator — the socket                       //
            // being down means no stream can possibly still be running.                            //
            socket.onClose(function () { _pending_meta = null; _pending_fs_chunks.clear(); useModuleStore.getState().clearAllLiveFlags(); setStatus('closed') })
            socket.onError(function () { _pending_meta = null; _pending_fs_chunks.clear(); useModuleStore.getState().clearAllLiveFlags(); setStatus('closed') })

            socket.connect()
        }

        return function ()
        {
            _refcount--
            if (_refcount === 0 && _socket !== null)
            {
                _pending_meta     = null
                _pending_fs_chunks.clear()
                _socket.close()
                _socket = null
            }
        }
    }, [])   // run once per component mount

    // ── TX helpers ────────────────────────────────────────────────────────

    // Send a JSON string. Plan B is "broadcast + Controller filter": the Gateway
    // does NOT fan out a single target_agents=[id1, id2, ...] message for us, so
    // multi-agent commands are LOOP-EMITTED here — one message per agent, each
    // carrying target_agents=[one_id]. This lets us filter per (agent, feature)
    // consent before emitting.
    //
    // Target resolution when the caller left target_agents empty:
    //   - "Frame focus" modules (screenshot / screen_stream / webcam) look at a
    //     single agent at a time → use focused_agent_id.
    //   - Every other module command → use selected_agent_ids so ONE click can
    //     drive many agents; falls back to focused_agent_id when nothing is
    //     selected.
    //
    // NOTE: the top-level "list_agents" message and any type without a
    // target_agents field are sent as-is (no fan-out, no permission filter).
    function sendCommand(json_string)
    {
        if (!_socket)
        {
            console.warn('[useAgentSocket] sendCommand called before socket is ready')
            return
        }

        // Fast path: not JSON we understand — just pass through.
        let msg
        try { msg = JSON.parse(json_string) }
        catch { _socket.send(json_string); return }

        // Only "request" and "power" carry target_agents and need fan-out +
        // permission filtering. Anything else (list_agents, etc.) is sent as-is.
        if (msg.type !== MSG_TYPE.REQUEST && msg.type !== MSG_TYPE.POWER)
        {
            _socket.send(json_string)
            return
        }

        // Respect explicit targeting from the caller; else auto-resolve targets.
        let targets
        if (Array.isArray(msg.target_agents) && msg.target_agents.length > 0)
        {
            targets = msg.target_agents
        }
        else
        {
            const focused_id = useAgentStore.getState().focused_agent_id
            if (FRAME_FOCUS_MODULES.has(msg.module))
            {
                targets = focused_id ? [focused_id] : []
            }
            else
            {
                const selected_ids = useAgentStore.getState().selected_agent_ids
                targets = (selected_ids && selected_ids.length > 0)
                    ? selected_ids
                    : (focused_id ? [focused_id] : [])
            }
        }

        if (targets.length === 0)
        {
            console.warn('[useAgentSocket] command dropped — no selection and no focused agent')
            return
        }

        fanoutSend(msg, targets)
    }

    // Loop-emit a module command to [focused_agent_id] (one agent).
    // Module tabs in FocusView call sendToFocused(buildAppList()) instead of
    // threading agent.id into every builder. Permission filtering still applies.
    // options.silent — when true, suppress the aggregate "N agents not granted"                  //
    // toast (used by polling tabs so a 3 s tick does not spam the operator).                     //
    function sendToFocused(json_string, options)
    {
        const focused_id = useAgentStore.getState().focused_agent_id
        if (!focused_id)
        {
            console.warn('[useAgentSocket] sendToFocused: no agent focused — message dropped')
            return
        }
        dispatchFanout(json_string, [focused_id], options)
    }

    // Loop-emit a module command to every agent in selected_agent_ids — one
    // message per agent (never a single multi-ID message). Permission filtering
    // applies, so only agents that granted the feature actually receive it.
    function sendToSelected(json_string, options)
    {
        const ids = useAgentStore.getState().selected_agent_ids
        if (!ids || ids.length === 0)
        {
            console.warn('[useAgentSocket] sendToSelected: no agents selected — message dropped')
            return
        }
        dispatchFanout(json_string, ids, options)
    }

    // ── Permission flow helpers (Plan B — consent before any module command) ─

    // Resolve which agents a permission action targets. An explicit agent_id
    // (from a per-agent PermissionGate) acts on that one agent; when omitted we
    // act on the whole multi-select set (bulk Connect / Disconnect), falling
    // back to the focused agent. Always returns an array so callers loop-emit.
    // Permission messages are NOT consent-filtered — they establish consent.
    function resolvePermissionTargets(agent_id)
    {
        if (agent_id) return [agent_id]
        const selected = useAgentStore.getState().selected_agent_ids
        if (selected && selected.length > 0) return selected
        const focused = useAgentStore.getState().focused_agent_id
        return focused ? [focused] : []
    }

    // Ask each target agent to grant a feature. Marks every pair 'requesting'
    // locally and loop-emits one permission_request per agent; each Agent reply
    // routes back to setPermissionResult.
    function requestPermission(feature, agent_id)
    {
        const targets = resolvePermissionTargets(agent_id)
        if (targets.length === 0)
        {
            console.warn('[useAgentSocket] requestPermission: no agent target — dropped')
            return
        }
        const perm_store = usePermissionStore.getState()
        for (const id of targets)
        {
            perm_store.requestPermission(id, feature)
            sendWithTargets(buildPermissionRequest(feature), [id])   // one per agent
        }
    }

    // Withdraw a feature from each target: loop-emit permission_revoke, reset
    // local consent to 'idle', and drop the live indicator (stream / keylog /
    // webcam) for that feature on that agent.
    function revokePermission(feature, agent_id)
    {
        const targets = resolvePermissionTargets(agent_id)
        if (targets.length === 0)
        {
            console.warn('[useAgentSocket] revokePermission: no agent target — dropped')
            return
        }
        const perm_store = usePermissionStore.getState()
        for (const id of targets)
        {
            sendWithTargets(buildPermissionRevoke(feature), [id])    // one per agent
            perm_store.revoke(id, feature)
            stopLocalFeature(id, feature)
        }
    }

    // Tell each target Agent to stop a running feature and clear its local live
    // indicator. Loop-emits one stop_module per agent.
    function stopModule(feature, agent_id)
    {
        const targets = resolvePermissionTargets(agent_id)
        if (targets.length === 0)
        {
            console.warn('[useAgentSocket] stopModule: no agent target — dropped')
            return
        }
        for (const id of targets)
        {
            sendWithTargets(buildStopModule(feature), [id])          // one per agent
            stopLocalFeature(id, feature)
        }
    }

    return { sendCommand, sendToFocused, sendToSelected, requestPermission, revokePermission, stopModule }
}

// ── Private: inject target_agents and send ───────────────────────────────────

async function sendToSocketE2EE(agent_id, msgObj) {
    if (!_socket) return;
    const jsonStr = JSON.stringify(msgObj);
    const sessionKey = useE2EEStore.getState().getSessionKey(agent_id);
    if (sessionKey) {
        const seq = useE2EEStore.getState().getSendSeqAndIncrement(agent_id);
        const iv = generateIV();
        const dataBuffer = new TextEncoder().encode(jsonStr);
        try {
            const ciphertextBuffer = await encryptAESGCM(sessionKey, dataBuffer, iv);
            const combined = new Uint8Array(12 + ciphertextBuffer.byteLength);
            combined.set(iv, 0);
            combined.set(new Uint8Array(ciphertextBuffer), 12);
            
            _socket.send(JSON.stringify({
                type: MSG_TYPE.E2EE_PAYLOAD,
                agent_id: agent_id,
                seq: seq,
                data: arrayBufferToBase64(combined.buffer)
            }));
        } catch (e) {
            console.error('[E2EE] Failed to encrypt message', e);
        }
    } else {
        console.warn(`[E2EE] Sending UNENCRYPTED message to ${agent_id}.`);
        _socket.send(jsonStr);
    }
}

// Parse the JSON string, set target_agents to the given array, re-stringify, send.
// Used by the permission helpers to emit ONE permission message per agent.
function sendWithTargets(json_string, target_ids)
{
    if (!_socket)
    {
        console.warn('[useAgentSocket] sendWithTargets called before socket is ready')
        return
    }

    try
    {
        const msg           = JSON.parse(json_string)
        msg.target_agents   = target_ids
        sendToSocketE2EE(target_ids[0], msg)
    }
    catch (err)
    {
        console.error('[useAgentSocket] failed to inject target_agents:', err)
    }
}

// ── Private: fan-out a module command per agent (Plan B broadcast + filter) ──

// Parse a builder's JSON string, then fan it out to the given agents.
// Entry point behind sendToFocused / sendToSelected.
function dispatchFanout(json_string, target_ids, options)
{
    if (!_socket)
    {
        console.warn('[useAgentSocket] dispatchFanout called before socket is ready')
        return
    }

    let msg
    try { msg = JSON.parse(json_string) }
    catch (err)
    {
        console.error('[useAgentSocket] dispatchFanout: bad JSON:', err)
        return
    }
    fanoutSend(msg, target_ids, options)
}

// Loop-emit one message per agent (never a single multi-ID message). For a
// permission-gated command (request / power) we only emit to agents that have
// already granted the matching feature; skipped agents are counted and reported
// in ONE aggregate toast so a bulk action does not spam N warnings.
function fanoutSend(msg, target_ids, options)
{
    if (!_socket)
    {
        console.warn('[useAgentSocket] fanoutSend called before socket is ready')
        return
    }

    const feature    = featureForMessage(msg)   // null → no consent needed
    const perm_store = usePermissionStore.getState()
    const silent     = options && options.silent === true                                           // Polling tabs pass silent:true so a 3 s tick does not fire the aggregate "N not granted" toast

    let   skipped    = 0

    for (const id of target_ids)
    {
        // Permission-gated: skip agents that have not granted this feature.
        if (feature && perm_store.getStatus(id, feature) !== 'granted')
        {
            skipped++
            continue
        }
        const one_msg         = { ...msg, target_agents: [id] }   // one agent per emit
        sendToSocketE2EE(id, one_msg)
    }

    if (skipped > 0 && !silent)
    {
        useUiStore.getState().addToast(`Đã bỏ qua ${skipped} agent chưa cấp quyền`, 'error')
    }
}

// ── Private: clear the live indicator for a feature after revoke / stop ──────

// Only sensitive streaming features have a local "active" flag to turn off.
// application / process / file / power carry no live indicator, so they no-op.
function stopLocalFeature(agent_id, feature)
{
    const module_store = useModuleStore.getState()
    switch (feature)
    {
        case FEATURE.SCREEN:
            module_store.setScreenStreamActive(agent_id, false)
            break
        case FEATURE.KEYLOG:
            module_store.setKeylogActive(agent_id, false)
            break
        case FEATURE.WEBCAM:
            module_store.setWebcamActive(agent_id, false)
            break
        case FEATURE.INPUT:
            module_store.setInputActive(agent_id, false)
            break
        default:
            break
    }
}

// ── RX dispatch: route incoming messages to the correct store action ─────────
//
// Routing table (message.type → store action):
//
//   agents_list        → AgentStore.setAgents(agents)
//   agent_status       → AgentStore.setAgentStatus(id, {online, in_session}); unknown id → resync list_agents
//   app_list_result    → ModuleStore.setModuleData(id, 'app', apps)
//   app_action_result  → toast (success / error)
//   proc_list_result   → ModuleStore.setModuleData(id, 'process', procs)
//   proc_kill_result   → toast (success / error)
//   keylog             → ModuleStore.appendKeylog(id, events)
//   keylog_started/stopped/denied → ModuleStore.setKeylogActive(id, …) (+ toast on denied)
//   stream_started/stopped        → ModuleStore.setScreenStreamActive(id, …)
//   webcam_started/stopped/denied → ModuleStore.setWebcamActive(id, …) (+ toast on denied)
//   frame_meta         → stored in _pending_meta; paired with next binary
//   fs_list_result     → ModuleStore.setFsEntries(id, path, entries)
//   fs_get_result      → ModuleStore.appendFileDownloadChunk(id, chunk_info)
//                        (JSON mode: decode data_base64 → bytes here;
//                         binary mode: stash meta, pair with next binary frame)
//   fs_put_result / fs_put_complete → ModuleStore.setFilePutAck(id, …)
//   fs_error           → toast
//   power_result       → toast (confirmed / cancelled)
//   policy_update_result → PolicyStore.setPolicyResult(id, …); toast on failure
//   permission_result  → PermissionStore.setPermissionResult(id, feature, granted) + toast

function dispatchMessage(msg, { setStatus, setAgents, setAgentStatus, setModuleData, appendKeylog, appendSysInfo, setKeylogActive, setWebcamActive, setScreenStreamActive, setInputActive, setFsEntries, appendFileDownloadChunk,setFilePutAck, setPolicyResult, setPermissionResult, addToast })
{
    // Every per-agent message MUST carry an agent_id after normalization.
    // Drop malformed messages so we never write into ModuleStore under an
    // "undefined" key. Types without agent_id (agents_list) are listed first
    // and are exempt from this guard.
    const AGENT_ID_EXEMPT = new Set([MSG_TYPE.AGENTS_LIST, MSG_TYPE.AUTH_EXPIRED])
    if (!AGENT_ID_EXEMPT.has(msg.type) && !msg.agent_id)
    {
        console.warn('[useAgentSocket] dropped message missing agent_id:', msg.type)
        return
    }

    switch (msg.type)
    {
        // ── Connection ────────────────────────────────────────────────────
        case MSG_TYPE.AGENTS_LIST:
            setAgents(msg.agents)
            // Init E2EE for all online agents
            msg.agents.forEach(a => {
                if (a.online) initE2EE(a.id, _socket)
            })
            break

        case MSG_TYPE.AGENT_STATUS:
        {
            // Realtime online / offline (and in_session) update for ONE agent.
            // Only patch the flags the Gateway actually reported.
            const status_patch = {}
            if (msg.online !== undefined)     status_patch.online     = msg.online
            if (msg.in_session !== undefined) status_patch.in_session = msg.in_session

            const is_known = useAgentStore.getState().agents.some((a) => a.id === msg.agent_id)
            if (is_known)
            {
                setAgentStatus(msg.agent_id, status_patch)
                // Agent went offline mid-stream → clear its live indicators so                     //
                // the red badge does not linger until the operator refreshes.                      //
                if (msg.online === false)
                {
                    useModuleStore.getState().clearLiveFlagsForAgent(msg.agent_id)
                    useE2EEStore.getState().setSessionState(msg.agent_id, 'uninitialized')
                }
                else if (msg.online === true)
                {
                    initE2EE(msg.agent_id, _socket)
                }
            }
            else if (_socket)
            {
                // A brand-new agent just announced itself — resync the full list
                // so the sidebar picks up its name / os / ip, not just the flag.
                _socket.send(buildListAgents())
            }
            break
        }

        // ── Application ───────────────────────────────────────────────────
        case MSG_TYPE.APP_LIST_RESULT:
            setModuleData(msg.agent_id, 'app', msg.apps)
            break

        case MSG_TYPE.APP_ACTION_RESULT:
            addToast(
                msg.success
                    ? `${msg.name}: ${msg.action === 'app_start' ? 'started' : 'stopped'}`
                    : `${msg.name}: action failed — ${msg.message}`,
                msg.success ? 'success' : 'error'
            )
            break

        // ── Process ───────────────────────────────────────────────────────
        case MSG_TYPE.PROC_LIST_RESULT:
            setModuleData(msg.agent_id, 'process', msg.processes)
            break

        case MSG_TYPE.PROC_KILL_RESULT:
            addToast(
                msg.success
                    ? `${msg.name ?? 'PID ' + msg.pid}: terminated`
                    : `PID ${msg.pid}: kill failed — ${msg.message}`,
                msg.success ? 'success' : 'error'
            )
            break

        // ── Keylog ────────────────────────────────────────────────────────
        case MSG_TYPE.KEYLOG:
            appendKeylog(msg.agent_id, msg.events)
            break

        case MSG_TYPE.KEYLOG_STARTED:
            setKeylogActive(msg.agent_id, true)
            break

        case MSG_TYPE.KEYLOG_STOPPED:
            setKeylogActive(msg.agent_id, false)
            break

        case MSG_TYPE.KEYLOG_DENIED:
            setKeylogActive(msg.agent_id, false)
            addToast(`Keylog denied on ${msg.agent_id}: ${msg.reason ?? 'user declined'}`, 'error')
            break

        // ── Screen / Webcam binary frames ─────────────────────────────────
        case MSG_TYPE.STREAM_STARTED:
            // Flip the transparency flag so AgentCard / TopBar light the red
            // dot — Live Screen is a sensitive module and must be visible.
            setScreenStreamActive(msg.agent_id, true)
            break

        case MSG_TYPE.STREAM_STOPPED:
            setScreenStreamActive(msg.agent_id, false)
            break

        case MSG_TYPE.FRAME_META:
            // Hold this meta until the next binary message arrives.
            // The onBinary callback in the lifecycle block above will
            // consume it and push the completed frame into ModuleStore.
            //
            // ORDERING GUARD: a fresh frame_meta arriving while one is still
            // pending means the previous meta's binary never came directly
            // after it — i.e. the Gateway interleaved another message between a
            // frame_meta and its JPEG. On a single socket this must NOT happen;
            // if it does, pairing would draw a frame into the wrong agent/module
            // slot. We keep the newest meta (last wins) but warn loudly so the
            // Gateway team can fix relay ordering. See docs note in this file.
            if (_pending_meta)
            {
                console.warn(
                    '[useAgentSocket] frame_meta arrived while a previous meta was still ' +
                    `unpaired (prev agent=${_pending_meta.agent_id}/${_pending_meta.module}, ` +
                    `new agent=${msg.agent_id}/${msg.module}) — Gateway may be interleaving ` +
                    'binary frames out of order'
                )
            }
            _pending_meta = msg
            break

        // ── Webcam ────────────────────────────────────────────────────────
        case MSG_TYPE.WEBCAM_STARTED:
            // Agent granted consent — flip the flag so WebcamTab lights up
            // the visible consent indicator ("Camera đang bật").
            setWebcamActive(msg.agent_id, true)
            break

        case MSG_TYPE.WEBCAM_STOPPED:
            setWebcamActive(msg.agent_id, false)
            break

        case MSG_TYPE.WEBCAM_DENIED:
            setWebcamActive(msg.agent_id, false)
            addToast(`Webcam denied on ${msg.agent_id}: ${msg.reason ?? 'user declined'}`, 'error')
            break

        // ── Remote Input ──────────────────────────────────────────────────
        case MSG_TYPE.INPUT_STARTED:
            setInputActive(msg.agent_id, true)
            break

        case MSG_TYPE.INPUT_STOPPED:
            setInputActive(msg.agent_id, false)
            break

        case MSG_TYPE.INPUT_DENIED:
            setInputActive(msg.agent_id, false)
            addToast(`Remote Input denied on ${msg.agent_id}: ${msg.reason ?? 'user declined'}`, 'error')
            break

        case MSG_TYPE.INPUT_RESULT:
            // Per-command ack — only surface a toast on failure (success is silent
            // so 60 fps mouse move does not spam the feed).
            if (msg.success === false)
            {
                addToast(`Input error on ${msg.agent_id}: ${msg.message ?? 'unknown'}`, 'error')
            }
            break

        // ── File ──────────────────────────────────────────────────────────
        case MSG_TYPE.FS_LIST_RESULT:
            // Merge this directory's entries into the per-agent file tree (sandbox only).
            setFsEntries(msg.agent_id, msg.path, msg.entries)
            break

        case MSG_TYPE.FS_GET_RESULT:
        {
            // Two chunk formats are supported (see docs/protocol/File.json):
            //   1) JSON mode  — the chunk bytes are inside data_base64.
            //   2) Binary mode — this JSON is only metadata; the next WS binary
            //                    frame carries the raw bytes. We stash the meta
            //                    into _pending_fs_chunks keyed by transfer_id so
            //                    parallel downloads do not clobber each other.
            if (msg.data_base64)
            {
                // Decode base64 → Uint8Array once at the boundary so downstream
                // (store + UI) only ever holds raw bytes.
                const binary = atob(msg.data_base64)
                const bytes  = new Uint8Array(binary.length)
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
                appendFileDownloadChunk(msg.agent_id,
                {
                    transfer_id  : msg.transfer_id,
                    chunk_index  : msg.chunk_index,
                    total_chunks : msg.total_chunks,
                    path         : msg.path,
                    total_size   : msg.total_size,
                    bytes,
                })
            }
            else
            {
                if (!msg.transfer_id)
                {
                    console.warn(
                        '[useAgentSocket] fs_get_result (binary mode) missing transfer_id — dropped; ' +
                        'cannot pair the following binary frame safely'
                    )
                    break
                }
                if (_pending_fs_chunks.has(msg.transfer_id))
                {
                    console.warn(
                        `[useAgentSocket] fs_get_result overwrites pending meta for transfer_id=${msg.transfer_id} ` +
                        '— previous binary never arrived (Gateway may have dropped it)'
                    )
                }
                _pending_fs_chunks.set(msg.transfer_id, msg)
            }
            break
        }

        case MSG_TYPE.FS_PUT_RESULT:
            // Per-chunk ack — FileTab advances the progress bar when this arrives.
            setFilePutAck(msg.agent_id, { ...msg, complete: false })
            break

        case MSG_TYPE.FS_PUT_COMPLETE:
            // Final ack — all chunks received by the Agent; FileTab marks upload as done.
            setFilePutAck(msg.agent_id, { ...msg, complete: true })
            break

        case MSG_TYPE.FS_ERROR:
            // Surface sandbox path errors as toast notifications.
            addToast(`File error on ${msg.agent_id}: ${msg.message}`, 'error')
            break

        // ── Policy ────────────────────────────────────────────────────────
        case MSG_TYPE.POLICY_UPDATE_RESULT:
            // Record per-agent result. Only surface a toast on FAILURE so a
            // successful multi-agent push does not spam N success toasts.
            setPolicyResult(msg.agent_id, { success: msg.success, message: msg.message })
            if (!msg.success)
            {
                addToast(`Policy update failed on ${msg.agent_id}: ${msg.message ?? 'unknown error'}`, 'error')
            }
            break

        // ── Permission (Plan B consent handshake) ─────────────────────────
        case MSG_TYPE.PERMISSION_RESULT:
            // Update the (agent, feature) status so PermissionGate enables or
            // keeps the module command buttons disabled, and toast the outcome.
            setPermissionResult(msg.agent_id, msg.feature, msg.granted)
            addToast(
                msg.granted
                    ? `${msg.feature} granted on ${msg.agent_id}`
                    : `${msg.feature} denied on ${msg.agent_id}: ${msg.message || 'user declined'}`,
                msg.granted ? 'success' : 'error'
            )
            break

        // ── E2EE ─────────────────────────────────────────────────────────
        case MSG_TYPE.E2EE_READY:
        {
            const e2eeStore = useE2EEStore.getState()
            e2eeStore.getAgentPin(msg.agent_id).then(async (pin) => {
                if (!pin) return;
                try {
                    const isValid = await verifyHMAC(msg.publicKey, msg.signature, pin)
                    if (!isValid) {
                        useUiStore.getState().addToast(`E2EE MitM Alert: Invalid signature from agent ${msg.agent_id}`, 'error')
                        return
                    }
                    const privateKey = _pendingE2EEKeys.get(msg.agent_id)
                    if (!privateKey) {
                        console.warn(`[E2EE] No pending private key for ${msg.agent_id}`)
                        return
                    }
                    
                    const agentPubKey = await importPublicKeyFromSPKI(msg.publicKey)
                    const sessionKey = await deriveSessionKey(privateKey, agentPubKey)
                    
                    e2eeStore.setSessionState(msg.agent_id, 'ready', sessionKey)
                    _pendingE2EEKeys.delete(msg.agent_id)
                    useUiStore.getState().addToast(`E2EE Handshake successful for ${msg.agent_id}`, 'success')
                } catch (e) {
                    console.error('[E2EE] Handshake finalize failed', e)
                }
            })
            break
        }

        // ── SysInfo ───────────────────────────────────────────────────────
        case MSG_TYPE.SYSINFO_RESULT:
            // Store latest snapshot AND append a percent-only sample to history
            // so the sparkline updates without re-computing anything downstream.
            appendSysInfo(msg.agent_id, msg)
            break

        // ── Power ─────────────────────────────────────────────────────────
        case MSG_TYPE.POWER_RESULT:
            // Show a toast so the operator sees the Agent's confirmation.
            addToast(
                msg.confirmed
                    ? `${msg.agent_id}: ${msg.action} confirmed`
                    : `${msg.agent_id}: ${msg.action} cancelled`,
                msg.confirmed ? 'success' : 'error'
            )
            break

        // ── Auth: access token expired mid-session ────────────────────────
        case MSG_TYPE.AUTH_EXPIRED:
            // Gateway told us our access JWT is no longer valid. Try one
            // refresh using the HttpOnly refresh cookie; on success reopen
            // the WS so the new handshake carries the fresh token; on
            // failure log the operator out.
            refreshAccessToken().then((result) =>
            {
                if (result.ok && _socket && typeof _socket.reopen === 'function')
                {
                    _socket.reopen()
                }
                else
                {
                    addToast('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.', 'error')
                    logout()
                }
            })
            break

        // ── Catch-all ─────────────────────────────────────────────────────
        default:
            console.warn('[useAgentSocket] unhandled message type:', msg.type)
    }
}
