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
import { buildListAgents, buildPolicyUpdate, normalizeIncoming, MSG_TYPE, MODULE } from '../services/Protocol'

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
import useConnectionStore                from '../store/ConnectionStore'
import useAgentStore                     from '../store/AgentStore'
import useModuleStore                    from '../store/ModuleStore'
import useUiStore                        from '../store/UiStore'
import usePolicyStore                    from '../store/PolicyStore'

// ── Singleton state (module-level, shared across all hook invocations) ────────

let _socket       = null   // the one shared socket instance
let _refcount     = 0      // how many mounted components hold a reference
let _pending_meta = null   // last frame_meta awaiting its binary companion

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
    const setModuleData    = useModuleStore.getState().setModuleData
    const appendKeylog     = useModuleStore.getState().appendKeylog
    const setKeylogActive   = useModuleStore.getState().setKeylogActive
    const setWebcamActive   = useModuleStore.getState().setWebcamActive
    const setScreenStreamActive = useModuleStore.getState().setScreenStreamActive
    const setFsEntries      = useModuleStore.getState().setFsEntries
    const setFileDownload   = useModuleStore.getState().setFileDownload
    const setFilePutAck     = useModuleStore.getState().setFilePutAck
    const setPolicyResult   = usePolicyStore.getState().setPolicyResult
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
                dispatchMessage(msg, { setStatus, setAgents, setModuleData, appendKeylog, setKeylogActive, setWebcamActive, setScreenStreamActive, setFsEntries, setFileDownload, setFilePutAck, setPolicyResult, addToast })
            })

            // Binary callback — pair incoming ArrayBuffer with the pending frame_meta.
            // This runs immediately after the frame_meta JSON callback above,
            // so _pending_meta is guaranteed to be the matching header.
            socket.onBinary(function (buffer)
            {
                if (!_pending_meta)
                {
                    console.warn('[useAgentSocket] binary arrived without pending frame_meta — dropped')
                    return
                }

                const meta      = _pending_meta
                _pending_meta   = null            // consume the pending meta

                // Route to the correct module slot (screen or webcam)
                const module_key = meta.module    // "screen" or "webcam"
                setModuleData(meta.agent_id, module_key, { frame: buffer, meta })
            })

            socket.onClose(function ()  { setStatus('closed') })
            socket.onError(function ()  { setStatus('closed') })

            socket.connect()
        }

        return function ()
        {
            _refcount--
            if (_refcount === 0 && _socket !== null)
            {
                _pending_meta = null
                _socket.close()
                _socket = null
            }
        }
    }, [])   // run once per component mount

    // ── TX helpers ────────────────────────────────────────────────────────

    // Send a JSON string. If the caller already put a non-empty target_agents
    // in the payload, we respect it and send unchanged. Otherwise we auto-fill
    // target_agents based on the module and the current UI selection:
    //
    //   - "Frame focus" modules (screenshot / screen_stream / webcam) look at
    //     a single agent at a time → use focused_agent_id.
    //   - Every other module command → use selected_agent_ids so ONE click can
    //     drive many agents in parallel (e.g. proc_list, app_start, keylog_start,
    //     power). If nothing is selected we fall back to focused_agent_id.
    //
    // NOTE: the top-level "list_agents" message and any type without a
    // target_agents field (e.g. hypothetical future admin pings) are sent as-is.
    //
    // TODO (protocol): confirm with the Gateway team that a "request"/"power"
    // message with target_agents = [id1, id2, ...] is fan-out to every listed
    // agent. Our docs/formatjson/*.json samples only show single-agent examples;
    // the multi-agent semantics need explicit confirmation before real backend.
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

        // Respect explicit targeting from the caller.
        if (Array.isArray(msg.target_agents) && msg.target_agents.length > 0)
        {
            _socket.send(json_string)
            return
        }

        // Only "request" and "power" carry target_agents. Anything else
        // (list_agents, etc.) is sent unchanged.
        if (msg.type !== MSG_TYPE.REQUEST && msg.type !== MSG_TYPE.POWER)
        {
            _socket.send(json_string)
            return
        }

        // Frame-focus modules always target ONE agent = the focused one.
        const focused_id = useAgentStore.getState().focused_agent_id
        if (FRAME_FOCUS_MODULES.has(msg.module))
        {
            if (!focused_id)
            {
                console.warn('[useAgentSocket] frame command dropped — no focused agent')
                return
            }
            msg.target_agents = [focused_id]
            _socket.send(JSON.stringify(msg))
            return
        }

        // Broadcast-capable command: prefer the multi-select set; otherwise fall
        // back to the focused agent so one-off actions in FocusView still work.
        const selected_ids = useAgentStore.getState().selected_agent_ids
        const targets = (selected_ids && selected_ids.length > 0)
            ? selected_ids
            : (focused_id ? [focused_id] : [])

        if (targets.length === 0)
        {
            console.warn('[useAgentSocket] command dropped — no selection and no focused agent')
            return
        }

        msg.target_agents = targets
        _socket.send(JSON.stringify(msg))
    }

    // Parse the JSON, overwrite target_agents with [focused_agent_id], re-send.
    // Designed for module tabs inside FocusView — they can call
    //   sendToFocused(buildAppList())
    // instead of manually threading agent.id into every builder call.
    // If no agent is focused the message is silently dropped (nothing to send to).
    function sendToFocused(json_string)
    {
        const focused_id = useAgentStore.getState().focused_agent_id
        if (!focused_id)
        {
            console.warn('[useAgentSocket] sendToFocused: no agent focused — message dropped')
            return
        }
        sendWithTargets(json_string, [focused_id])
    }

    // Parse the JSON, overwrite target_agents with selected_agent_ids, re-send.
    // Designed for batch / multi-agent commands.
    // If no agents are selected the message is silently dropped.
    function sendToSelected(json_string)
    {
        const ids = useAgentStore.getState().selected_agent_ids
        if (!ids || ids.length === 0)
        {
            console.warn('[useAgentSocket] sendToSelected: no agents selected — message dropped')
            return
        }
        sendWithTargets(json_string, ids)
    }

    return { sendCommand, sendToFocused, sendToSelected }
}

// ── Private: inject target_agents and send ───────────────────────────────────

// Parse the JSON string, set target_agents to the given array, re-stringify, send.
// Shared logic behind sendToFocused / sendToSelected.
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
        _socket.send(JSON.stringify(msg))
    }
    catch (err)
    {
        console.error('[useAgentSocket] failed to inject target_agents:', err)
    }
}

// ── RX dispatch: route incoming messages to the correct store action ─────────
//
// Routing table (message.type → store action):
//
//   agents_list        → AgentStore.setAgents(agents)
//   agent_status       → (TODO) update single agent online flag
//   app_list_result    → ModuleStore.setModuleData(id, 'app', apps)
//   app_action_result  → console.info (tab re-fetches on next poll)
//   proc_list_result   → ModuleStore.setModuleData(id, 'process', procs)
//   proc_kill_result   → console.info (tab re-fetches on next poll)
//   keylog             → ModuleStore.appendKeylog(id, events)
//   keylog_started/stopped/denied → (TODO) update active-state flag
//   stream_started/stopped        → (TODO) update active-state flag
//   webcam_started/stopped/denied → (TODO) update active-state flag
//   frame_meta         → stored in _pending_meta; paired with next binary
//   fs_list_result     → ModuleStore.setModuleData(id, 'file', {entries, path})
//   fs_get_result      → (TODO) forward to FileModule download handler
//   fs_put_result / fs_put_complete → (TODO) forward upload progress
//   fs_error           → (TODO) surface file error in FileModule
//   power_result       → (TODO) surface in PowerModule

function dispatchMessage(msg, { setStatus, setAgents, setModuleData, appendKeylog, setKeylogActive, setWebcamActive, setScreenStreamActive, setFsEntries, setFileDownload, setFilePutAck, setPolicyResult, addToast })
{
    switch (msg.type)
    {
        // ── Connection ────────────────────────────────────────────────────
        case MSG_TYPE.AGENTS_LIST:
            setAgents(msg.agents)
            break

        case MSG_TYPE.AGENT_STATUS:
            // TODO: update a single agent's online flag
            break

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

        // ── File ──────────────────────────────────────────────────────────
        case MSG_TYPE.FS_LIST_RESULT:
            // Merge this directory's entries into the per-agent file tree (sandbox only).
            setFsEntries(msg.agent_id, msg.path, msg.entries)
            break

        case MSG_TYPE.FS_GET_RESULT:
            // Store the result; FileTab watches this slot and triggers a browser download.
            setFileDownload(msg.agent_id, msg)
            break

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

        // ── Catch-all ─────────────────────────────────────────────────────
        default:
            console.warn('[useAgentSocket] unhandled message type:', msg.type)
    }
}
