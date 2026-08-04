// WebcamTab/index.jsx — live webcam feed for one focused agent.
//
// SHARED TEMPLATE — the actual JPEG decode + canvas draw is done by the
// FrameCanvas template imported from 'src/components/FrameCanvas.jsx'.
// The SAME primitive powers Livescreen (ScreenTab / GridView / FocusView) and
// this WebcamTab, so both modules go through ONE code path for decoding a
// binary frame buffer and painting it to a <canvas>. If we ever change how
// frames are rendered (e.g. add downscaling or a filter), we only touch
// FrameCanvas and every consumer benefits — no duplicate logic to keep in sync.
//
// STREAM LIFECYCLE:
//   - "Bật webcam"  → buildWebcamStart → Agent shows consent popup.
//                     On accept, Agent replies webcam_started + streams frames.
//                     On reject, Agent replies webcam_denied (toast is raised
//                     by UseAgentSocket; the button flips back to idle).
//   - "Tắt webcam"  → buildWebcamStop → Agent stops the camera stream.
//   - On UNMOUNT (user switches tab or leaves focus), the cleanup effect
//     stops the stream automatically so the camera does not stay on for an
//     agent nobody is watching. This is important for privacy — an orphaned
//     webcam stream would keep the physical camera LED on.
//
// This component only reads state from ModuleStore.data[agent.id].webcam and
// ModuleStore.data[agent.id].webcam_active; it never touches the socket
// directly — every command goes through useAgentSocket.

import { useState, useEffect, useRef } from 'react'
import { Video, VideoOff, ShieldCheck, WifiOff } from 'lucide-react'
import useModuleStore                    from '../../../store/ModuleStore'
import useUiStore                        from '../../../store/UiStore'
import useAgentSocket                    from '../../../hooks/UseAgentSocket'
import { useGuardedSend, usePendingConsent } from '../../PermissionGate'
import
{
    buildWebcamStart,
    buildWebcamStop,
}
from '../../../services/Protocol'
// Shared frame-render template — same file used by Livescreen. Do NOT
// re-implement canvas / ImageBitmap logic here; keep it in FrameCanvas.
import FrameCanvas from '../../FrameCanvas'

const WEBCAM_FPS     = 15   // per docs/protocol/webcam.json default
const WEBCAM_QUALITY = 60   // JPEG quality (0–100)

// Allowed ranges — matched to Protocol.js buildWebcamStart guard.
const FPS_MIN     = 1
const FPS_MAX     = 30
const QUALITY_MIN = 1
const QUALITY_MAX = 100

// Parse a form input string as a positive integer inside [min, max].
function parseIntInRange(raw, min, max, field_label)
{
    const trimmed = String(raw).trim()
    if (trimmed === '') return { value: NaN, error: `${field_label} is required` }
    if (!/^\d+$/.test(trimmed)) return { value: NaN, error: `${field_label} must be an integer` }
    const n = parseInt(trimmed, 10)
    if (n < min || n > max) return { value: NaN, error: `${field_label} must be in [${min}, ${max}]` }
    return { value: n, error: '' }
}

function WebcamTab({ agent })
{
    const { sendCommand }   = useAgentSocket()
    const addToast          = useUiStore((s) => s.addToast)
    const guardedSend       = useGuardedSend()
    const is_pending        = usePendingConsent()
    const [streaming, setStreaming] = useState(false)

    // ── Stream settings form ─────────────────────────────────────────
    const [fps_input,     setFpsInput]     = useState(String(WEBCAM_FPS))
    const [quality_input, setQualityInput] = useState(String(WEBCAM_QUALITY))
    const fps_parsed     = parseIntInRange(fps_input,     FPS_MIN,     FPS_MAX,     'FPS')
    const quality_parsed = parseIntInRange(quality_input, QUALITY_MIN, QUALITY_MAX, 'Quality')
    const form_valid     = !fps_parsed.error && !quality_parsed.error

    // Read this agent's webcam frame_buffer straight from ModuleStore.
    // The store slot is filled by UseAgentSocket's binary handler whenever
    // a frame_meta with module="webcam" is followed by its JPEG payload.
    const frame_buffer  = useModuleStore((s) => s.data[agent.id]?.webcam?.frame        ?? null)
    const frame_meta    = useModuleStore((s) => s.data[agent.id]?.webcam?.meta         ?? null)
    const webcam_active = useModuleStore((s) => s.data[agent.id]?.webcam_active        ?? false)

    // Track which agent we started for, so cleanup stops the right one when
    // the focused agent changes without an explicit stop click.
    const streaming_agent_ref = useRef(null)

    // Stop the webcam stream for the previously-focused agent on unmount OR
    // when the focused agent changes. Without this the camera LED would stay
    // on for an agent that nobody is looking at any more — a privacy leak.
    useEffect(function ()
    {
        return function ()
        {
            if (streaming_agent_ref.current)
            {
                sendCommand(buildWebcamStop([streaming_agent_ref.current]))
                streaming_agent_ref.current = null
                setStreaming(false)
            }
        }
    }, [agent.id])

    function handleStart()
    {
        if (!form_valid) return
        guardedSend(function ()
        {
            try
            {
                sendCommand(buildWebcamStart(fps_parsed.value, quality_parsed.value, [agent.id]))
                streaming_agent_ref.current = agent.id
                setStreaming(true)
            }
            catch (err)
            {
                addToast(err.message ?? 'Invalid webcam settings', 'error')
            }
        })
    }

    function handleStop()
    {
        sendCommand(buildWebcamStop([agent.id]))
        streaming_agent_ref.current = null
        setStreaming(false)
    }

    // Small human-readable line about the last frame received.
    const resolution_text = frame_meta
        ? `${frame_meta.w}×${frame_meta.h}  ·  seq #${frame_meta.seq}`
        : 'No frame yet'

    // Consent is "confirmed" only when the Agent has echoed webcam_started
    // (webcam_active === true). Merely clicking the button does not count —
    // the Agent user might still deny the popup.
    const consent_confirmed = webcam_active && streaming

    return (
        <div className="screen-tab">
            {/* ── Toolbar ────────────────────────────────────── */}
            <div className="screen-tab__toolbar">
                <span className="screen-tab__title">
                    Webcam — {agent.name}
                </span>

                <div className="screen-tab__actions">
                    {streaming
                        ? (
                            <button
                                className="screen-tab__btn screen-tab__btn--danger"
                                onClick={handleStop}
                                title="Stop the webcam stream"
                            >
                                <VideoOff size={14} strokeWidth={2} />
                                Tắt webcam
                            </button>
                        )
                        : (
                            <button
                                className="screen-tab__btn screen-tab__btn--primary"
                                onClick={handleStart}
                                disabled={!agent.online || !form_valid || is_pending}
                                title={is_pending
                                    ? 'Đang xin quyền...'
                                    : form_valid
                                        ? 'Ask the Agent for webcam consent and start streaming'
                                        : 'Fix the settings error first'}
                            >
                                <Video size={14} strokeWidth={2} />
                                Bật webcam
                            </button>
                        )
                    }
                </div>
            </div>

            {/* ── Stream settings (fps + quality) ─────────────── */}
            <form
                className="form-inline"
                onSubmit={(e) => { e.preventDefault(); handleStart() }}
            >
                <label htmlFor="webcam-fps" className="form-inline__label">FPS:</label>
                <input
                    id="webcam-fps"
                    className={`form-inline__input form-inline__input--num${fps_parsed.error ? ' form-inline__input--error' : ''}`}
                    type="number"
                    min={FPS_MIN}
                    max={FPS_MAX}
                    step="1"
                    inputMode="numeric"
                    value={fps_input}
                    onChange={(e) => setFpsInput(e.target.value)}
                    disabled={streaming}
                    aria-invalid={Boolean(fps_parsed.error)}
                />
                <label htmlFor="webcam-quality" className="form-inline__label">Quality:</label>
                <input
                    id="webcam-quality"
                    className={`form-inline__input form-inline__input--num${quality_parsed.error ? ' form-inline__input--error' : ''}`}
                    type="number"
                    min={QUALITY_MIN}
                    max={QUALITY_MAX}
                    step="1"
                    inputMode="numeric"
                    value={quality_input}
                    onChange={(e) => setQualityInput(e.target.value)}
                    disabled={streaming}
                    aria-invalid={Boolean(quality_parsed.error)}
                />
                {(fps_parsed.error || quality_parsed.error) && (
                    <span className="form-inline__error">
                        {fps_parsed.error || quality_parsed.error}
                    </span>
                )}
            </form>

            {/* ── Status bar ─────────────────────────────────── */}
            <div className="screen-tab__status">
                {consent_confirmed && (
                    // Visible consent indicator — matches the Agent-side camera
                    // LED so the operator can see at a glance that the remote
                    // machine is actively broadcasting its webcam.
                    <span
                        className="screen-tab__consent-badge screen-tab__consent-badge--on"
                        title="Agent granted consent — webcam is broadcasting"
                    >
                        <ShieldCheck size={12} strokeWidth={2.5} />
                        ● CAM ON · {fps_parsed.value || WEBCAM_FPS} fps
                    </span>
                )}
                {streaming && !webcam_active && (
                    // Waiting on the Agent user to accept the consent popup.
                    <span className="screen-tab__consent-badge screen-tab__consent-badge--waiting">
                        Waiting for consent…
                    </span>
                )}
                <span className="screen-tab__resolution">{resolution_text}</span>
            </div>

            {/* ── Frame display (shared template) ────────────── */}
            <div className="screen-tab__canvas-wrapper">
                {!agent.online
                    ? (
                        <div className="screen-tab__placeholder">
                            <WifiOff size={40} strokeWidth={1.25} />
                            <span>Agent is offline — webcam unavailable</span>
                        </div>
                    )
                    : frame_buffer
                    ? (
                        // Use the SHARED FrameCanvas template — same decoder /
                        // renderer that Livescreen uses. Passing module="webcam"
                        // and label="WEBCAM" so the corner badge is visible.
                        <FrameCanvas
                            frame_buffer={frame_buffer}
                            frame_meta={frame_meta}
                            module="webcam"
                            label="WEBCAM"
                            width="100%"
                            height="100%"
                        />
                    )
                    : (
                        <div className="screen-tab__placeholder">
                            <Video size={40} strokeWidth={1.25} />
                            <span>Press "Bật webcam" — the Agent will show a consent popup before streaming</span>
                        </div>
                    )
                }
            </div>
        </div>
    )
}

export default WebcamTab
