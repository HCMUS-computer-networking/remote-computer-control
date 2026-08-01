// ScreenTab/index.jsx — screenshot + live stream panel for one focused agent.
//
// STREAM LIFECYCLE:
//   - "Chụp 1 lần" sends a single screenshot request (module:"screenshot").
//     The Agent replies with one frame_meta + binary pair.
//   - "Bắt đầu stream" starts a 24 fps continuous stream for the focused agent.
//     Frames arrive as repeating frame_meta + binary pairs and are rendered
//     by FrameCanvas in real time.
//   - "Dừng stream" stops the stream explicitly.
//   - On UNMOUNT (user switches tab or leaves focus), the cleanup function
//     stops the stream automatically to prevent leaked intervals and wasted
//     bandwidth. This is critical — without it, MockSocket (or the real
//     Gateway) would keep sending frames to an agent that nobody is watching.
//
// The component reads the latest frame from ModuleStore.data[agent_id].screen.
// It never touches the socket directly — all commands go via useAgentSocket.

import { useState, useEffect, useRef } from 'react'
import { Camera, Play, Square, WifiOff } from 'lucide-react'
import useModuleStore                   from '../../../store/ModuleStore'
import useAgentSocket                   from '../../../hooks/UseAgentSocket'
import
{
    buildScreenshot,
    buildStreamStart,
    buildStreamStop,
}
from '../../../services/Protocol'
import FrameCanvas from '../../FrameCanvas'

const FOCUS_FPS     = 24   // full frame rate for focused agent
const FOCUS_QUALITY = 70   // JPEG quality (0–100)

function ScreenTab({ agent })
{
    const { sendCommand }   = useAgentSocket()
    const [streaming, setStreaming] = useState(false)

    // Subscribe to this agent's screen frame data
    const frame_buffer = useModuleStore((s) => s.data[agent.id]?.screen?.frame ?? null)
    const frame_meta   = useModuleStore((s) => s.data[agent.id]?.screen?.meta  ?? null)

    // Track the agent_id we started streaming for, so cleanup stops the right one.
    // Using a ref because the cleanup function must read the LATEST value,
    // not the value captured at render time.
    const streaming_agent_ref = useRef(null)

    // Stop the stream for the previously-focused agent when the component
    // unmounts OR when the focused agent changes (agent.id in deps).
    // Without this, switching agents in focus mode would leave the old
    // agent's stream running — orphaned frames with nobody watching.
    useEffect(function ()
    {
        return function ()
        {
            if (streaming_agent_ref.current)
            {
                sendCommand(buildStreamStop([streaming_agent_ref.current]))
                streaming_agent_ref.current = null
                setStreaming(false)
            }
        }
    }, [agent.id])

    function handleScreenshot()
    {
        sendCommand(buildScreenshot([agent.id]))
    }

    function handleStartStream()
    {
        sendCommand(buildStreamStart(FOCUS_FPS, FOCUS_QUALITY, [agent.id]))
        streaming_agent_ref.current = agent.id
        setStreaming(true)
    }

    function handleStopStream()
    {
        sendCommand(buildStreamStop([agent.id]))
        streaming_agent_ref.current = null
        setStreaming(false)
    }

    // Build a human-readable resolution string from frame_meta
    const resolution_text = frame_meta
        ? `${frame_meta.w}×${frame_meta.h}  ·  seq #${frame_meta.seq}`
        : 'No frame yet'

    return (
        <div className="screen-tab">
            {/* ── Toolbar ────────────────────────────────────── */}
            <div className="screen-tab__toolbar">
                <span className="screen-tab__title">
                    Screen — {agent.name}
                </span>

                <div className="screen-tab__actions">
                    {/* single screenshot button */}
                    <button
                        className="screen-tab__btn screen-tab__btn--secondary"
                        onClick={handleScreenshot}
                        disabled={streaming || !agent.online}
                        title="Capture a single screenshot"
                    >
                        <Camera size={14} strokeWidth={2} />
                        Chụp 1 lần
                    </button>

                    {/* stream toggle */}
                    {streaming
                        ? (
                            <button
                                className="screen-tab__btn screen-tab__btn--danger"
                                onClick={handleStopStream}
                                title="Stop the live stream"
                            >
                                <Square size={14} strokeWidth={2} />
                                Dừng stream
                            </button>
                        )
                        : (
                            <button
                                className="screen-tab__btn screen-tab__btn--primary"
                                onClick={handleStartStream}
                                disabled={!agent.online}
                                title="Start 24 fps live stream"
                            >
                                <Play size={14} strokeWidth={2} />
                                Bắt đầu stream
                            </button>
                        )
                    }
                </div>
            </div>

            {/* ── Status bar ─────────────────────────────────── */}
            <div className="screen-tab__status">
                {streaming && (
                    <span className="screen-tab__live-badge">● LIVE {FOCUS_FPS} fps</span>
                )}
                <span className="screen-tab__resolution">{resolution_text}</span>
            </div>

            {/* ── Frame display ──────────────────────────────── */}
            <div className="screen-tab__canvas-wrapper">
                {!agent.online
                    ? (
                        <div className="screen-tab__placeholder">
                            <WifiOff size={40} strokeWidth={1.25} />
                            <span>Agent is offline — cannot capture or stream</span>
                        </div>
                    )
                    : frame_buffer
                        ? <FrameCanvas frame_buffer={frame_buffer} width="100%" height="100%" />
                        : (
                            <div className="screen-tab__placeholder">
                                <Camera size={40} strokeWidth={1.25} />
                                <span>Press "Chụp 1 lần" or "Bắt đầu stream" to see the Agent screen</span>
                            </div>
                        )
                }
            </div>
        </div>
    )
}

export default ScreenTab
