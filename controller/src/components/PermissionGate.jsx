/* PermissionGate — shared consent wrapper for every module tab (Plan B).

   C5 — one-button UX: the operator no longer clicks a separate "Xin quyền"
   button. Every module action button calls `guardedSend(sendFn)` provided via
   React context. Behaviour:
     - already granted        → run sendFn immediately;
     - not granted yet        → queue sendFn, fire permission_request, and
                                 wait; when the Agent grants consent the whole
                                 queue is drained in order.
     - denied or 30 s timeout → toast an error and clear the queue.

   The bar on top of the panel now shows only status + Disconnect (when
   granted). No Connect button. Children are NOT wrapped in a disabled
   fieldset — action buttons stay clickable and drive the consent flow
   themselves via `useGuardedSend` / `usePendingConsent`. */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { ShieldCheck, ShieldAlert, PlugZap, Loader } from 'lucide-react'

import usePermissionStore from '../store/PermissionStore'
import useUiStore         from '../store/UiStore'
import useAgentSocket     from '../hooks/UseAgentSocket'

// How long we wait for the Agent user to accept the consent popup before
// giving up and toasting an error. Long enough to read the popup, short
// enough that stuck flows recover on their own.
const CONSENT_TIMEOUT_MS = 30_000

// Short human-readable label for the current consent status.
function statusLabel(status)
{
    if (status === 'requesting') return 'Waiting for consent…'   // waiting for Agent reply
    if (status === 'granted')    return 'Authorized'             // consent granted
    if (status === 'denied')     return 'Denied'                 // consent denied
    return 'Not connected'                                       // idle — no request yet
}

// Context shared with every action button inside the gate.
// { guardedSend(sendFn), is_pending_consent }
const PermissionContext = createContext(null)

// Public hook — every module tab uses this to wrap its action handlers.
// Throws if the tab is rendered outside a PermissionGate (dev safety).
export function useGuardedSend()
{
    const ctx = useContext(PermissionContext)
    if (!ctx) throw new Error('useGuardedSend must be used inside <PermissionGate>')
    return ctx.guardedSend
}

// True while we are waiting for the Agent user to grant consent. Buttons use
// this to disable themselves and optionally show a spinner. Returns false
// outside a PermissionGate so read-only tabs (SysInfo) can call it safely.
export function usePendingConsent()
{
    const ctx = useContext(PermissionContext)
    return ctx?.is_pending_consent ?? false
}

function PermissionGate({ feature, agent_id, children })
{
    const { requestPermission, revokePermission, stopModule } = useAgentSocket()
    const addToast = useUiStore((s) => s.addToast)

    // Subscribe to just this (agent, feature) status — no re-render for others.
    const status = usePermissionStore((s) => s.permissions[agent_id]?.[feature] ?? 'idle')

    // Local flow state: whether we have an in-flight request awaiting reply.
    const [is_pending_consent, setPendingConsent] = useState(false)

    // Queued sendFns that are waiting for consent to arrive. Kept in a ref so
    // we can drain them from a store-change effect without stale closures.
    const pending_actions_ref = useRef([])
    const timeout_ref         = useRef(null)

    // Clear everything: local state, queue, and any pending timeout.
    // Used after grant-drain, deny, timeout, or unmount.
    const resetPending = useCallback(function ()
    {
        setPendingConsent(false)
        pending_actions_ref.current = []
        if (timeout_ref.current)
        {
            clearTimeout(timeout_ref.current)
            timeout_ref.current = null
        }
    }, [])

    // React to status changes while a request is in flight.
    useEffect(function ()
    {
        if (!is_pending_consent) return

        if (status === 'granted')
        {
            // Drain the queue in the order it was pushed.
            const actions = pending_actions_ref.current
            pending_actions_ref.current = []
            if (timeout_ref.current) { clearTimeout(timeout_ref.current); timeout_ref.current = null }
            setPendingConsent(false)
            for (const fn of actions)
            {
                try { fn() }
                catch (err) { console.error('[PermissionGate] queued action threw:', err) }
            }
        }
        else if (status === 'denied' || status === 'idle')
        {
            if (status === 'denied') addToast(`Agent denied ${feature} consent`, 'error')
            resetPending()
        }
    }, [status, is_pending_consent, feature, addToast, resetPending])

    // On unmount OR when the (agent, feature) pair changes, drop the queue so
    // a stale sendFn cannot fire against a different agent later.
    useEffect(function ()
    {
        return function () { resetPending() }
    }, [agent_id, feature, resetPending])

    // Guarded send: enforce consent-before-action from a single call site.
    // If consent is already granted, sendFn runs synchronously (same tick as
    // the click). Otherwise we queue it and request consent.
    const guardedSend = useCallback(function (sendFn)
    {
        if (typeof sendFn !== 'function') return

        // Read fresh status — the closure's `status` may be one render behind.
        const current = usePermissionStore.getState().permissions[agent_id]?.[feature] ?? 'idle'
        if (current === 'granted')
        {
            sendFn()
            return
        }

        pending_actions_ref.current.push(sendFn)

        // Only fire the request + start the timer for the FIRST queued action.
        if (!is_pending_consent)
        {
            setPendingConsent(true)
            
            // Fix: Only send the network request if the global store isn't already tracking it.
            // This prevents duplicate packets during React Strict Mode remounts.
            if (current !== 'requesting')
            {
                requestPermission(feature, agent_id)
            }
            
            timeout_ref.current = setTimeout(function ()
            {
                addToast(`Consent request for ${feature} timed out`, 'error')
                resetPending()
                usePermissionStore.getState().setPermissionResult(agent_id, feature, false)
            }, CONSENT_TIMEOUT_MS)
        }
    }, [agent_id, feature, is_pending_consent, requestPermission, addToast, resetPending])

    // Disconnect = revoke the grant AND tell the Agent to stop the feature.
    function handleDisconnect()
    {
        revokePermission(feature, agent_id)
        stopModule(feature, agent_id)
        resetPending()
    }

    const is_granted    = status === 'granted'
    const shown_status  = is_pending_consent ? 'requesting' : status
    const shown_label   = is_pending_consent ? 'Requesting consent…' : statusLabel(status)
    // Memoize the context value so consumers (7 module tabs) only re-render
    // when guardedSend or is_pending_consent actually change identity.
    const ctx_value = useMemo(
        () => ({ guardedSend, is_pending_consent }),
        [guardedSend, is_pending_consent]
    )

    return (
        <PermissionContext.Provider value={ctx_value}>
            <div className="permission-gate">

                {/* ── consent bar ──────────────────────────────────────────── */}
                <div className="permission-gate__bar">

                    <span className={`permission-gate__badge permission-gate__badge--${shown_status}`}>
                        {is_pending_consent
                            ? <Loader size={14} className="permission-gate__spin" />
                            : is_granted
                                ? <ShieldCheck size={14} />
                                : <ShieldAlert  size={14} />}
                        <span className="permission-gate__feature">{feature}</span>
                        <span className="permission-gate__status">{shown_label}</span>
                    </span>

                    <div className="permission-gate__actions">
                        {is_granted && !is_pending_consent && (
                            <button
                                className="action-btn action-btn--stop"
                                onClick={handleDisconnect}
                                title="Revoke consent and stop the feature"
                            >
                                <PlugZap size={12} /> Disconnect
                            </button>
                        )}
                    </div>

                </div>

                {/* ── module command area — buttons run consent flow themselves ── */}
                <div className="permission-gate__body">
                    {children}
                </div>

            </div>
        </PermissionContext.Provider>
    )
}

export default PermissionGate
