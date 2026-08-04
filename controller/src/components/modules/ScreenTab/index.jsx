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
import { Camera, Play, Square, WifiOff, MousePointer2 } from 'lucide-react'
import useModuleStore                   from '../../../store/ModuleStore'
import useUiStore                       from '../../../store/UiStore'
import usePermissionStore               from '../../../store/PermissionStore'
import useAgentSocket                   from '../../../hooks/UseAgentSocket'
import { useGuardedSend, usePendingConsent } from '../../PermissionGate'
import
{
    buildScreenshot,
    buildStreamStart,
    buildStreamStop,
    buildInputMouseMove,
    buildInputMouseClick,
    buildInputKey,
    FEATURE,
}
from '../../../services/Protocol'
import FrameCanvas from '../../FrameCanvas'

// Throttle mouse_move to ~33 fps. The Agent handler is fire-and-forget so
// the socket can survive higher rates, but there is no visual benefit past
// the stream's own frame rate and we want to leave headroom for JPEGs.
const MOUSE_MOVE_MIN_INTERVAL_MS = 30

// Translate a browser KeyboardEvent to a Windows Virtual-Key code. Covers
// the subset a remote-control operator actually needs (letters, digits,
// arrows, common editing/function keys). Returns null for unmapped keys
// so the caller can fall back to input_type for printable characters.
function keyEventToVk(evt)
{
    const k = evt.key
    if (k.length === 1)
    {
        const upper = k.toUpperCase()
        const code  = upper.charCodeAt(0)
        if (code >= 0x30 && code <= 0x39) return code                        // '0'..'9' → VK_0..VK_9
        if (code >= 0x41 && code <= 0x5A) return code                        // 'A'..'Z' → VK_A..VK_Z
        return null                                                          // punctuation → prefer input_type
    }
    switch (k)
    {
        case 'Backspace' : return 0x08
        case 'Tab'       : return 0x09
        case 'Enter'     : return 0x0D
        case 'Shift'     : return 0x10
        case 'Control'   : return 0x11
        case 'Alt'       : return 0x12
        case 'Escape'    : return 0x1B
        case 'Space'     : return 0x20
        case 'PageUp'    : return 0x21
        case 'PageDown'  : return 0x22
        case 'End'       : return 0x23
        case 'Home'      : return 0x24
        case 'ArrowLeft' : return 0x25
        case 'ArrowUp'   : return 0x26
        case 'ArrowRight': return 0x27
        case 'ArrowDown' : return 0x28
        case 'Insert'    : return 0x2D
        case 'Delete'    : return 0x2E
        case 'F1' : return 0x70
        case 'F2' : return 0x71
        case 'F3' : return 0x72
        case 'F4' : return 0x73
        case 'F5' : return 0x74
        case 'F6' : return 0x75
        case 'F7' : return 0x76
        case 'F8' : return 0x77
        case 'F9' : return 0x78
        case 'F10': return 0x79
        case 'F11': return 0x7A
        case 'F12': return 0x7B
        default   : return null
    }
}

function mouseButtonName(button_index)
{
    if (button_index === 1) return 'middle'
    if (button_index === 2) return 'right'
    return 'left'
}

const FOCUS_FPS     = 24   // full frame rate for focused agent
const FOCUS_QUALITY = 70   // JPEG quality (0–100)

// Allowed ranges (matched to Protocol.js buildStreamStart guard).
const FPS_MIN     = 1
const FPS_MAX     = 60
const QUALITY_MIN = 1
const QUALITY_MAX = 100

// Parse a form input string as a positive integer inside [min, max].
// Returns { value, error } — value is the parsed number when valid, else NaN.
function parseIntInRange(raw, min, max, field_label)
{
    const trimmed = String(raw).trim()
    if (trimmed === '') return { value: NaN, error: `${field_label} is required` }
    if (!/^\d+$/.test(trimmed)) return { value: NaN, error: `${field_label} must be an integer` }
    const n = parseInt(trimmed, 10)
    if (n < min || n > max) return { value: NaN, error: `${field_label} must be in [${min}, ${max}]` }
    return { value: n, error: '' }
}

function ScreenTab({ agent })
{
    const { sendCommand, requestPermission, revokePermission, stopModule } = useAgentSocket()
    const addToast          = useUiStore((s) => s.addToast)
    const guardedSend       = useGuardedSend()
    const is_pending        = usePendingConsent()
    const [streaming, setStreaming] = useState(false)

    // Remote Input state — subscribed from stores so the toolbar reflects the
    // real consent status (Agent may deny or revoke asynchronously).
    const input_status = usePermissionStore((s) => s.permissions[agent.id]?.[FEATURE.INPUT] ?? 'idle')
    const input_active = useModuleStore((s) => s.data[agent.id]?.input_active ?? false)
    // "Điều khiển" is enabled only when the Agent has confirmed input_started
    // (Controller received permission_result+input_started). Until then the
    // capture div ignores events, so a laggy grant cannot leak clicks.
    const input_ready  = input_status === 'granted' && input_active

    // ── Stream settings form ─────────────────────────────────────────
    const [fps_input,     setFpsInput]     = useState(String(FOCUS_FPS))
    const [quality_input, setQualityInput] = useState(String(FOCUS_QUALITY))
    const fps_parsed     = parseIntInRange(fps_input,     FPS_MIN,     FPS_MAX,     'FPS')
    const quality_parsed = parseIntInRange(quality_input, QUALITY_MIN, QUALITY_MAX, 'Quality')
    const form_valid     = !fps_parsed.error && !quality_parsed.error

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
        guardedSend(function () { sendCommand(buildScreenshot([agent.id])) })
    }

    function handleStartStream()
    {
        if (!form_valid) return
        guardedSend(function ()
        {
            try
            {
                sendCommand(buildStreamStart(fps_parsed.value, quality_parsed.value, [agent.id]))
                streaming_agent_ref.current = agent.id
                setStreaming(true)
            }
            catch (err)
            {
                addToast(err.message ?? 'Invalid stream settings', 'error')
            }
        })
    }

    function handleStopStream()
    {
        sendCommand(buildStreamStop([agent.id]))
        streaming_agent_ref.current = null
        setStreaming(false)
    }

    // ── Remote Input capture ──────────────────────────────────────────────
    // canvas_wrap_ref points to the <div> that hosts <FrameCanvas>. We read
    // the <canvas>'s intrinsic width/height (= Agent screen resolution, set
    // by the last keyframe) to remap browser-space pixels into Agent-space.
    const canvas_wrap_ref  = useRef(null)
    const last_move_ref    = useRef(0)                                                                  // timestamp of the last mouse_move actually sent

    function handleToggleInput()
    {
        if (input_status === 'granted')
        {
            // Revoke also clears input_active via the store and tells the
            // Agent to hide its blue "K" overlay.
            revokePermission(FEATURE.INPUT, agent.id)
            stopModule(FEATURE.INPUT, agent.id)
            return
        }
        requestPermission(FEATURE.INPUT, agent.id)
    }

    // Cleanup: if operator leaves the tab or switches agent while Remote
    // Input is granted, revoke the grant so the Agent's overlay does not
    // linger and stray clicks cannot be sent after the tab unmounts.
    useEffect(function ()
    {
        return function ()
        {
            const current = usePermissionStore.getState().permissions[agent.id]?.[FEATURE.INPUT]
            if (current === 'granted' || current === 'requesting')
            {
                revokePermission(FEATURE.INPUT, agent.id)
                stopModule(FEATURE.INPUT, agent.id)
            }
        }
    }, [agent.id, revokePermission, stopModule])

    // Focus the capture wrapper the moment Remote Input becomes usable so
    // the operator can start typing without an extra click. Losing focus on
    // toggle-off is intentional — we don't want a stale focus target to
    // keep swallowing browser shortcuts once capture is disabled.
    useEffect(function ()
    {
        if (input_ready && canvas_wrap_ref.current)
        {
            canvas_wrap_ref.current.focus()
        }
    }, [input_ready])

    // Map an event's client coords to Agent-screen pixel coords. Returns
    // null when the canvas has not yet received a keyframe (no intrinsic
    // resolution) — the caller must drop the event in that case.
    function toAgentCoords(evt)
    {
        const wrap = canvas_wrap_ref.current
        if (!wrap) return null
        const cvs = wrap.querySelector('canvas')
        if (!cvs || cvs.width === 0 || cvs.height === 0) return null
        const rect = cvs.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) return null
        const x = Math.round(((evt.clientX - rect.left) / rect.width)  * cvs.width)
        const y = Math.round(((evt.clientY - rect.top)  / rect.height) * cvs.height)
        // Clamp so a rounding overshoot at the right/bottom edge does not
        // ship coordinates outside the Agent's actual screen.
        const cx = Math.max(0, Math.min(cvs.width  - 1, x))
        const cy = Math.max(0, Math.min(cvs.height - 1, y))
        return { x: cx, y: cy }
    }

    function handleCaptureMouseMove(evt)
    {
        if (!input_ready) return
        const now = performance.now()
        if (now - last_move_ref.current < MOUSE_MOVE_MIN_INTERVAL_MS) return
        const pt = toAgentCoords(evt)
        if (!pt) return
        last_move_ref.current = now
        try { sendCommand(buildInputMouseMove(pt.x, pt.y, [agent.id])) }
        catch (err) { console.warn('[ScreenTab] mouse_move build failed:', err) }
    }

    function handleCaptureMouseDown(evt)
    {
        if (!input_ready) return
        // Move first so the click lands where the operator sees the cursor,
        // even if the throttle just skipped the last move event.
        const pt = toAgentCoords(evt)
        if (pt)
        {
            try { sendCommand(buildInputMouseMove(pt.x, pt.y, [agent.id])) } catch { /* ignore */ }
        }
        try { sendCommand(buildInputMouseClick(mouseButtonName(evt.button), 'down', [agent.id])) }
        catch (err) { console.warn('[ScreenTab] mouse_down build failed:', err) }
        evt.preventDefault()                                                                            // stop native focus / drag-select on the wrapper
    }

    function handleCaptureMouseUp(evt)
    {
        if (!input_ready) return
        try { sendCommand(buildInputMouseClick(mouseButtonName(evt.button), 'up', [agent.id])) }
        catch (err) { console.warn('[ScreenTab] mouse_up build failed:', err) }
        evt.preventDefault()
    }

    function handleCaptureContextMenu(evt)
    {
        // Right-click must not open the browser context menu when we are
        // forwarding it as an Agent right-click.
        if (input_ready) evt.preventDefault()
    }

    function handleCaptureKeyDown(evt)
    {
        if (!input_ready) return
        const vk = keyEventToVk(evt)
        if (vk === null) return                                                                         // unmapped printable — printable input needs input_type UI
        try { sendCommand(buildInputKey(vk, 'down', [agent.id])) }
        catch (err) { console.warn('[ScreenTab] key_down build failed:', err) }
        evt.preventDefault()                                                                            // swallow browser shortcuts (Tab, arrows, F5, etc.) while capturing
    }

    function handleCaptureKeyUp(evt)
    {
        if (!input_ready) return
        const vk = keyEventToVk(evt)
        if (vk === null) return
        try { sendCommand(buildInputKey(vk, 'up', [agent.id])) }
        catch (err) { console.warn('[ScreenTab] key_up build failed:', err) }
        evt.preventDefault()
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
                        disabled={streaming || !agent.online || is_pending}
                        title={is_pending ? 'Đang xin quyền...' : 'Capture a single screenshot'}
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
                                disabled={!agent.online || !form_valid || is_pending}
                                title={is_pending
                                    ? 'Đang xin quyền...'
                                    : form_valid
                                        ? `Start ${fps_parsed.value} fps live stream`
                                        : 'Fix the settings error first'}
                            >
                                <Play size={14} strokeWidth={2} />
                                Bắt đầu stream
                            </button>
                        )
                    }

                    {/* Remote Input toggle — asks feature="input" (distinct   */}
                    {/* from screen). The Agent shows a blue "K" overlay while */}
                    {/* granted; leaving the tab auto-revokes.                 */}
                    <button
                        className={`screen-tab__btn ${input_ready ? 'screen-tab__btn--danger' : 'screen-tab__btn--secondary'}`}
                        onClick={handleToggleInput}
                        disabled={!agent.online || !streaming || input_status === 'requesting'}
                        title={!streaming
                            ? 'Bắt đầu stream trước khi điều khiển'
                            : input_status === 'requesting'
                                ? 'Đang xin quyền điều khiển...'
                                : input_ready
                                    ? 'Ngừng điều khiển từ xa'
                                    : 'Xin quyền điều khiển chuột/bàn phím'}
                    >
                        <MousePointer2 size={14} strokeWidth={2} />
                        {input_ready ? 'Đang điều khiển' : 'Điều khiển'}
                    </button>
                </div>
            </div>

            {/* ── Stream settings (fps + quality) ─────────────── */}
            <form
                className="form-inline"
                onSubmit={(e) => { e.preventDefault(); handleStartStream() }}
            >
                <label htmlFor="screen-fps" className="form-inline__label">FPS:</label>
                <input
                    id="screen-fps"
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
                <label htmlFor="screen-quality" className="form-inline__label">Quality:</label>
                <input
                    id="screen-quality"
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
                {streaming && (
                    <span className="screen-tab__live-badge">● LIVE {fps_parsed.value || FOCUS_FPS} fps</span>
                )}
                {input_ready && (
                    <span className="screen-tab__live-badge" style={{ background: '#1e88e5' }}>
                        ● INPUT
                    </span>
                )}
                <span className="screen-tab__resolution">{resolution_text}</span>
            </div>

            {/* ── Frame display ──────────────────────────────── */}
            {/* The wrapper is tabIndex=0 so it can receive keyboard focus     */}
            {/* while Remote Input is active. Handlers are attached always but */}
            {/* they no-op unless input_ready — this keeps the DOM stable and  */}
            {/* avoids remount/keyboard-focus loss on toggle.                  */}
            <div
                ref={canvas_wrap_ref}
                className="screen-tab__canvas-wrapper"
                tabIndex={input_ready ? 0 : -1}
                style={{ cursor: input_ready ? 'crosshair' : 'default', outline: 'none' }}
                onMouseMove   ={handleCaptureMouseMove}
                onMouseDown   ={handleCaptureMouseDown}
                onMouseUp     ={handleCaptureMouseUp}
                onContextMenu ={handleCaptureContextMenu}
                onKeyDown     ={handleCaptureKeyDown}
                onKeyUp       ={handleCaptureKeyUp}
            >
                {!agent.online
                    ? (
                        <div className="screen-tab__placeholder">
                            <WifiOff size={40} strokeWidth={1.25} />
                            <span>Agent is offline — cannot capture or stream</span>
                        </div>
                    )
                    : frame_buffer
                        ? <FrameCanvas frame_buffer={frame_buffer} frame_meta={frame_meta} width="100%" height="100%" />
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
