// PowerTab/index.jsx — power actions for one focused agent.
//
// Four buttons:
//   - Lock     → sent IMMEDIATELY (no countdown — locking is not disruptive).
//   - Restart  → 10-second countdown modal with a Cancel button.
//   - Shutdown → 10-second countdown modal with a Cancel button.
//   - Sleep    → 10-second countdown modal with a Cancel button.
//
// Countdown modal:
//   - Reusable — one <CountdownModal> handles all three destructive actions.
//     The parent just passes the action code + a human label.
//   - If the countdown reaches 0, we send `power` with that action.
//   - If the operator clicks Cancel, we do NOT send anything to the Agent
//     (nothing was sent to start with — the countdown lives entirely on the
//     Controller side, per docs/formatjson/power.json). We only surface a
//     local "cancelled" toast so the operator sees the action was aborted.
//
// All commands go through useAgentSocket — never touch the socket directly.

import { useState, useEffect } from 'react'
import { Lock, RotateCcw, Power, Moon, X } from 'lucide-react'
import useAgentSocket from '../../../hooks/UseAgentSocket'
import useUiStore     from '../../../store/UiStore'
import { buildPower, POWER_ACTION } from '../../../services/Protocol'

const COUNTDOWN_SECONDS = 10   // matches spec — 10 s window to abort

// ── Reusable countdown modal ───────────────────────────────────────────────
//
// Props:
//   action    — POWER_ACTION.* code, forwarded verbatim into buildPower().
//   label     — human-readable verb shown in the modal title ("Restart", ...).
//   agent     — the target agent object (used only for display).
//   onConfirm — called with the action code when countdown reaches 0.
//   onCancel  — called when the user clicks Cancel (or hits Esc).
function CountdownModal({ action, label, agent, onConfirm, onCancel })
{
    const [remaining, setRemaining] = useState(COUNTDOWN_SECONDS)

    // One shared timer ticks every second; when it hits 0 we call onConfirm.
    // Cleanup clears the interval on unmount so a cancelled countdown never
    // fires a stray onConfirm after the modal is gone.
    useEffect(function ()
    {
        const timer_id = setInterval(function ()
        {
            setRemaining(function (prev)
            {
                if (prev <= 1)
                {
                    clearInterval(timer_id)
                    // Fire in a microtask so React finishes this state update first.
                    Promise.resolve().then(function () { onConfirm(action) })
                    return 0
                }
                return prev - 1
            })
        }, 1000)

        // Also allow Esc to cancel — a common expectation for modals.
        function onKey(e) { if (e.key === 'Escape') onCancel() }
        window.addEventListener('keydown', onKey)

        return function ()
        {
            clearInterval(timer_id)
            window.removeEventListener('keydown', onKey)
        }
    }, [action, onConfirm, onCancel])

    return (
        <div
            className="power-modal__overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby="power-modal-title"
            onClick={onCancel}   // click outside to cancel
            style={{
                position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                zIndex: 1000,
            }}
        >
            <div
                className="power-modal__card"
                onClick={function (e) { e.stopPropagation() }}
                style={{
                    background: 'var(--bg-elevated)',
                    color: 'var(--text-primary)',
                    borderRadius: 8,
                    padding: '20px 24px',
                    minWidth: 340,
                    maxWidth: 420,
                    boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
                }}
            >
                <div id="power-modal-title" style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
                    Confirm {label}
                </div>

                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
                    About to <strong>{label.toLowerCase()}</strong> agent <strong>{agent.name}</strong>.
                    Click Cancel to abort.
                </div>

                {/* Large visible countdown so the operator cannot miss it */}
                <div style={{
                    fontSize: 48, fontWeight: 700, textAlign: 'center',
                    color: remaining <= 3 ? '#c62828' : 'var(--text-primary)',
                    marginBottom: 16, fontVariantNumeric: 'tabular-nums',
                }}>
                    {remaining}s
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                    <button
                        className="screen-tab__btn screen-tab__btn--secondary"
                        onClick={onCancel}
                        autoFocus   // focus Cancel by default — safer to abort than to confirm
                    >
                        <X size={14} strokeWidth={2} />
                        Hủy
                    </button>
                </div>
            </div>
        </div>
    )
}

// ── Main tab ───────────────────────────────────────────────────────────────

function PowerTab({ agent })
{
    const { sendCommand } = useAgentSocket()
    const addToast        = useUiStore((s) => s.addToast)

    // When set, a countdown modal is showing for this action.
    // null means no modal is open.
    const [pending, setPending] = useState(null)   // { action, label } | null

    // Lock is immediate — no countdown, no modal.
    function handleLock()
    {
        sendCommand(buildPower(POWER_ACTION.LOCK, [agent.id]))
        addToast(`Lock sent to ${agent.name}`, 'info')
    }

    // Restart / Shutdown / Sleep all open the same modal — reuse.
    function askConfirm(action, label)
    {
        setPending({ action, label })
    }

    // Called by the modal when its countdown expires.
    function handleConfirm(action)
    {
        sendCommand(buildPower(action, [agent.id]))
        setPending(null)
    }

    // Called by the modal on Cancel / Esc / click-outside.
    // We do NOT send anything — the countdown lived entirely on the
    // Controller side, so nothing needs to be retracted on the Agent.
    function handleCancel()
    {
        if (pending)
        {
            addToast(`${pending.label} cancelled`, 'info')
        }
        setPending(null)
    }

    return (
        <div className="screen-tab">
            {/* ── Toolbar ────────────────────────────────────── */}
            <div className="screen-tab__toolbar">
                <span className="screen-tab__title">
                    Power — {agent.name}
                </span>
            </div>

            {/* ── Action grid ────────────────────────────────── */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: 12,
                padding: 16,
            }}>
                <button
                    className="screen-tab__btn screen-tab__btn--secondary"
                    onClick={handleLock}
                    title="Lock the Agent screen immediately"
                    style={{ padding: 16, justifyContent: 'center' }}
                >
                    <Lock size={16} strokeWidth={2} />
                    Lock (ngay lập tức)
                </button>

                <button
                    className="screen-tab__btn screen-tab__btn--primary"
                    onClick={function () { askConfirm(POWER_ACTION.RESTART, 'Restart') }}
                    title="Restart the Agent machine after a 10-second countdown"
                    style={{ padding: 16, justifyContent: 'center' }}
                >
                    <RotateCcw size={16} strokeWidth={2} />
                    Restart (10s)
                </button>

                <button
                    className="screen-tab__btn screen-tab__btn--danger"
                    onClick={function () { askConfirm(POWER_ACTION.SHUTDOWN, 'Shutdown') }}
                    title="Shut down the Agent machine after a 10-second countdown"
                    style={{ padding: 16, justifyContent: 'center' }}
                >
                    <Power size={16} strokeWidth={2} />
                    Shutdown (10s)
                </button>

                <button
                    className="screen-tab__btn screen-tab__btn--secondary"
                    onClick={function () { askConfirm(POWER_ACTION.SLEEP, 'Sleep') }}
                    title="Put the Agent machine to sleep after a 10-second countdown"
                    style={{ padding: 16, justifyContent: 'center' }}
                >
                    <Moon size={16} strokeWidth={2} />
                    Sleep (10s)
                </button>
            </div>

            {/* Countdown modal — one instance drives all three delayed actions. */}
            {pending && (
                <CountdownModal
                    action={pending.action}
                    label={pending.label}
                    agent={agent}
                    onConfirm={handleConfirm}
                    onCancel={handleCancel}
                />
            )}
        </div>
    )
}

export default PowerTab
