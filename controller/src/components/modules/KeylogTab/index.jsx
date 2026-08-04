/* KeylogTab — scrollable terminal log of keystroke events received from the Agent.
   The Agent always shows a consent popup and a visible indicator before sending any
   data; this component only RENDERS what the Agent voluntarily pushes. */
import { useRef, useEffect, useState } from 'react'
import { Keyboard, Circle, Trash2, Download, Play, Square } from 'lucide-react'

import useModuleStore                    from '../../../store/ModuleStore'
import useAgentSocket                    from '../../../hooks/UseAgentSocket'
import { useGuardedSend, usePendingConsent } from '../../PermissionGate'
import { buildKeylogStart, buildKeylogStop } from '../../../services/Protocol'

// Distance (px) from the bottom; within this range auto-scroll stays active.
const SCROLL_THRESHOLD = 60

// Stable empty array — prevents a new [] reference on every selector call.
const EMPTY_EVENTS = []

// Build a display string from one raw event: "Alt+Tab", "Ctrl+C", "h", etc.
function formatEvent(evt)
{
    const parts = []
    if (evt.ctrl)  parts.push('Ctrl')
    if (evt.alt)   parts.push('Alt')
    // Only show Shift prefix for special keys (e.g. "Shift+F5"); for plain
    // letters the key field already holds the shifted character.
    if (evt.shift && evt.key.length > 1) parts.push('Shift')
    parts.push(evt.key)
    return parts.join('+')
}

// Format a unix millisecond timestamp as HH:MM:SS (24-hour, local time).
function formatTime(ts_ms)
{
    return new Date(ts_ms).toLocaleTimeString([], { hour12: false })
}

function KeylogTab({ agent })
{
    const { sendToFocused } = useAgentSocket()
    const guardedSend       = useGuardedSend()
    const is_pending        = usePendingConsent()

    // Subscribe to just this agent's keylog slice — no re-render for other agents.
    const events      = useModuleStore((s) => s.data[agent.id]?.keylog        ?? EMPTY_EVENTS)
    const is_active   = useModuleStore((s) => s.data[agent.id]?.keylog_active ?? false)
    const clearModule = useModuleStore((s) => s.clearModule)

    // true while the user has scrolled up so we do not yank them back down.
    const [scroll_paused, setScrollPaused] = useState(false)

    const log_ref    = useRef(null)   // the scrollable <div> element
    const bottom_ref = useRef(null)   // invisible sentinel at the very bottom

    // Scroll to latest entry whenever the list grows, unless paused.
    useEffect(function ()
    {
        if (!scroll_paused && bottom_ref.current)
        {
            bottom_ref.current.scrollIntoView({ behavior: 'smooth' })
        }
    }, [events.length, scroll_paused])

    // Detect scroll direction: pause auto-scroll when user reads older lines;
    // resume when they return near the bottom.
    function handleScroll()
    {
        const el = log_ref.current
        if (!el) return
        const dist_from_bottom = el.scrollHeight - el.scrollTop - el.clientHeight
        setScrollPaused(dist_from_bottom > SCROLL_THRESHOLD)
    }

    function handleStart()  { guardedSend(() => sendToFocused(buildKeylogStart())) }
    function handleStop()   { sendToFocused(buildKeylogStop())  }   // stop needs no fresh consent
    function handleClear()  { clearModule(agent.id, 'keylog')   }

    // Trigger a browser download of the buffered log as plain text.
    function handleExport()
    {
        const lines = events.map((evt) =>
            `${formatTime(evt.timestamp_ms)}  ${formatEvent(evt)}`
        )
        const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
        const url  = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href     = url
        link.download = `keylog_${agent.id}_${Date.now()}.txt`
        link.click()
        URL.revokeObjectURL(url)
    }

    // Jump to bottom and resume auto-scroll when the notice is clicked.
    function handleResumeScroll()
    {
        setScrollPaused(false)
        if (bottom_ref.current)
        {
            bottom_ref.current.scrollIntoView({ behavior: 'smooth' })
        }
    }

    return (
        <div className="keylog-tab">

            {/* ── toolbar ───────────────────────────────────────────── */}
            <div className="keylog-tab__toolbar">

                <div className="keylog-tab__title-group">
                    {/* Consent indicator — always visible; pulses red while active.
                        Shows OFFLINE when the agent is unreachable. */}
                    <span className={`keylog-tab__indicator${is_active ? ' keylog-tab__indicator--live' : ''}`}>
                        <Circle size={8} fill="currentColor" />
                        {!agent.online ? 'OFFLINE' : is_active ? 'LIVE' : 'IDLE'}
                    </span>
                    <span className="keylog-tab__title">
                        Input Activity — {agent.name}
                    </span>
                </div>

                <div className="keylog-tab__actions">
                    {!is_active
                        ? (
                            <button
                                className="action-btn action-btn--start"
                                onClick={handleStart}
                                disabled={!agent.online || is_pending}
                                title={is_pending ? 'Đang xin quyền...' : agent.online ? 'Start keylog (requires Agent consent)' : 'Agent is offline'}
                            >
                                <Play size={12} /> Start
                            </button>
                        )
                        : (
                            <button
                                className="action-btn action-btn--stop"
                                onClick={handleStop}
                                title="Stop keylog"
                            >
                                <Square size={12} /> Stop
                            </button>
                        )
                    }
                    <button
                        className="action-btn action-btn--neutral"
                        onClick={handleClear}
                        disabled={events.length === 0}
                        title="Clear buffer"
                    >
                        <Trash2 size={12} /> Clear
                    </button>
                    <button
                        className="action-btn action-btn--neutral"
                        onClick={handleExport}
                        disabled={events.length === 0}
                        title="Export as .txt"
                    >
                        <Download size={12} /> Export
                    </button>
                </div>

            </div>

            {/* ── scrollable terminal log ───────────────────────────── */}
            <div
                ref={log_ref}
                className="keylog-tab__log"
                onScroll={handleScroll}
            >
                {events.length === 0
                    ? (
                        <div className="keylog-tab__empty">
                            <Keyboard size={32} strokeWidth={1.25} />
                            <span>{agent.online ? 'No events — press Start to begin capturing.' : 'Agent is offline — no input to capture.'}</span>
                        </div>
                    )
                    : events.map((evt, i) => (
                        <div key={`${evt.timestamp_ms}-${i}`} className="keylog-tab__row">
                            <span className="keylog-tab__time">{formatTime(evt.timestamp_ms)}</span>
                            <span className="keylog-tab__key">{formatEvent(evt)}</span>
                        </div>
                    ))
                }
                {/* Invisible anchor — scrollIntoView() targets this to jump to bottom */}
                <div ref={bottom_ref} />
            </div>

            {/* ── "scroll to latest" pill — shown while paused and active ── */}
            {scroll_paused && is_active && (
                <button
                    className="keylog-tab__scroll-notice"
                    onClick={handleResumeScroll}
                >
                    ↓ Scroll to latest
                </button>
            )}

        </div>
    )
}

export default KeylogTab
