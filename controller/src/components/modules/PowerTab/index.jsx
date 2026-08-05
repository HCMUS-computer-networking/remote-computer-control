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
//     Controller side, per docs/protocol/power.json). We only surface a
//     local "cancelled" toast so the operator sees the action was aborted.
//
// All commands go through useAgentSocket — never touch the socket directly.

import { useState, useEffect, useRef } from 'react'
import { Lock, RotateCcw, Power, Moon, X, WifiOff } from 'lucide-react'
import useAgentSocket     from '../../../hooks/UseAgentSocket'
import useUiStore         from '../../../store/UiStore'
import usePermissionStore from '../../../store/PermissionStore'
import { useGuardedSend, usePendingConsent } from '../../PermissionGate'
import { buildPower, POWER_ACTION, FEATURE } from '../../../services/Protocol'

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

    // Hold the latest onConfirm / onCancel in refs so the countdown effect
    // does NOT need them in its deps. Reason: parents that re-render often
    // (e.g. TopBar reacting to live frames) would otherwise recreate these
    // callbacks each render → the effect would tear down and rebuild the
    // interval every tick → the countdown would freeze at its start value.
    const on_confirm_ref = useRef(onConfirm)
    const on_cancel_ref  = useRef(onCancel)
    useEffect(function ()
    {
        on_confirm_ref.current = onConfirm
        on_cancel_ref.current  = onCancel
    })

    // Cancelled flag guards the microtask below: if the modal unmounted
    // between the "prev <= 1" branch and the microtask firing, we must not
    // still call onConfirm (which would send a shutdown after user cancel).
    useEffect(function ()
    {
        let cancelled = false

        const timer_id = setInterval(function ()
        {
            setRemaining(function (prev)
            {
                if (prev <= 1)
                {
                    clearInterval(timer_id)
                    Promise.resolve().then(function ()
                    {
                        if (!cancelled) on_confirm_ref.current(action)
                    })
                    return 0
                }
                return prev - 1
            })
        }, 1000)

        function onKey(e) { if (e.key === 'Escape') on_cancel_ref.current() }
        window.addEventListener('keydown', onKey)

        return function ()
        {
            cancelled = true
            clearInterval(timer_id)
            window.removeEventListener('keydown', onKey)
        }
    }, [action])   // only reset when the action itself changes

    return (
        <div
            className="power-modal__overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby="power-modal-title"
            onClick={onCancel}   // click outside to cancel
        >
            <div
                className="power-modal__card"
                onClick={function (e) { e.stopPropagation() }}
            >
                <div id="power-modal-title" className="power-modal__title">
                    Confirm {label}
                </div>

                <div className="power-modal__msg">
                    About to <strong>{label.toLowerCase()}</strong> agent <strong>{agent.name}</strong>.
                    Click Cancel to abort.
                </div>

                {/* Large visible countdown so the operator cannot miss it.
                    Turns danger-red in the final 3 seconds. */}
                <div className={`power-modal__count${remaining <= 3 ? ' power-modal__count--urgent' : ''}`}>
                    {remaining}s
                </div>

                <div className="power-modal__actions">
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
    const guardedSend     = useGuardedSend()
    const is_pending      = usePendingConsent()

    // When set, a countdown modal is showing for this action.
    // null means no modal is open.
    const [pending, setPending] = useState(null)   // { action, label } | null
    
    useEffect(function () {
        if (agent && !agent.online) {
            setPending(null)
        }
    }, [agent?.online])

    // Lock is immediate — no countdown, no modal.
    function handleLock()
    {
        guardedSend(function ()
        {
            sendCommand(buildPower(POWER_ACTION.LOCK, [agent.id]))
            addToast(`Lock sent to ${agent.name}`, 'info')
        })
    }

    // Restart / Shutdown / Sleep all open the same modal — reuse.
    // Consent is requested BEFORE the countdown starts, so the operator does
    // not stare at a 10-second timer only to discover the Agent refused.
    function askConfirm(action, label)
    {
        guardedSend(function () { setPending({ action, label }) })
    }

    // Called by the modal when its countdown expires.
    // Consent was secured when the modal opened (askConfirm → guardedSend),
    // but the operator may have revoked it during the 10 s window via the
    // Disconnect button. Re-check now so a destructive power action is never
    // sent silently after consent was withdrawn.
    function handleConfirm(action)
    {
        const status = usePermissionStore.getState().permissions[agent.id]?.[FEATURE.POWER] ?? 'idle'
        if (status !== 'granted')
        {
            addToast('Quyền Power đã bị thu hồi — hủy lệnh.', 'error')
            setPending(null)
            return
        }
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

            {/* Offline note — power actions cannot reach an unreachable agent. */}
            {!agent.online && (
                <div className="module-offline">
                    <WifiOff size={40} strokeWidth={1.25} />
                    <span>Agent is offline — power actions are unavailable</span>
                </div>
            )}

            {/* ── Action grid ────────────────────────────────── */}
            <div className="power-tab__grid">
                <button
                    className="screen-tab__btn screen-tab__btn--secondary power-tab__btn"
                    onClick={handleLock}
                    disabled={!agent.online || is_pending}
                    title="Lock the Agent screen immediately"
                >
                    <Lock size={16} strokeWidth={2} />
                    Lock (ngay lập tức)
                </button>

                <button
                    className="screen-tab__btn screen-tab__btn--primary power-tab__btn"
                    onClick={function () { askConfirm(POWER_ACTION.RESTART, 'Restart') }}
                    disabled={!agent.online || is_pending}
                    title="Restart the Agent machine after a 10-second countdown"
                >
                    <RotateCcw size={16} strokeWidth={2} />
                    Restart (10s)
                </button>

                <button
                    className="screen-tab__btn screen-tab__btn--danger power-tab__btn"
                    onClick={function () { askConfirm(POWER_ACTION.SHUTDOWN, 'Shutdown') }}
                    disabled={!agent.online || is_pending}
                    title="Shut down the Agent machine after a 10-second countdown"
                >
                    <Power size={16} strokeWidth={2} />
                    Shutdown (10s)
                </button>

                <button
                    className="screen-tab__btn screen-tab__btn--secondary power-tab__btn"
                    onClick={function () { askConfirm(POWER_ACTION.SLEEP, 'Sleep') }}
                    disabled={!agent.online || is_pending}
                    title="Put the Agent machine to sleep after a 10-second countdown"
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
