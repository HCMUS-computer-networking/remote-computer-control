// useBatchGuardedSend.js — consent-before-command for a SET of agents (multi-agent grids).
//
// PermissionGate handles the single focused agent. The module grids need the
// same "ask consent, then run" guarantee but for every SELECTED agent at once.
// This hook replays that flow per agent WITHOUT touching the socket layer:
//   - agent already granted the feature → send immediately;
//   - not granted                       → queue this agent's send + fire one
//                                          permission_request for it; when the
//                                          Agent grants, drain that agent's send.
//   - denied / 30 s timeout             → drop that agent's queued send.
//
// Each agent keeps its OWN popup + grant (by design — N agents = N popups), so
// no batch state leaks between machines.

import { useCallback, useEffect, useRef } from 'react'

import useAgentSocket     from './UseAgentSocket'
import usePermissionStore from '../store/PermissionStore'
import useUiStore         from '../store/UiStore'

// How long to wait for an Agent to accept before dropping its queued send.
// Matches PermissionGate's CONSENT_TIMEOUT_MS so both flows feel identical.
const BATCH_CONSENT_TIMEOUT_MS = 30_000

export default function useBatchGuardedSend()
{
    const { sendCommand, requestPermission } = useAgentSocket()

    // agent_id -> { feature, buildFn, timer }. Ref (not state) so the store
    // subscription can drain it without stale closures / extra renders.
    const pending = useRef(new Map())

    // Watch consent changes: when a queued agent flips to 'granted', run its
    // send; when it flips to 'denied'/'idle', drop it. One subscription for the
    // whole hook lifetime — cheap, fires only on permission mutations.
    useEffect(function ()
    {
        const unsubscribe = usePermissionStore.subscribe(function ()
        {
            if (pending.current.size === 0) return
            const store = usePermissionStore.getState()
            for (const [id, entry] of Array.from(pending.current.entries()))
            {
                const status = store.getStatus(id, entry.feature)
                if (status === 'granted')
                {
                    clearTimeout(entry.timer)
                    pending.current.delete(id)
                    try { sendCommand(entry.buildFn(id)) }
                    catch (err) { console.warn('[batchGuardedSend] send after grant failed:', err) }
                }
                else if (status === 'denied' || status === 'idle')
                {
                    clearTimeout(entry.timer)
                    pending.current.delete(id)
                }
            }
        })

        return function ()
        {
            unsubscribe()
            for (const [, entry] of pending.current) clearTimeout(entry.timer)
            pending.current.clear()
        }
    }, [sendCommand])

    // batchSend(feature, agentIds, buildFn) — buildFn(id) returns the JSON string
    // for ONE agent (e.g. (id) => buildKeylogStart([id])). feature = FEATURE.*.
    return useCallback(function (feature, agentIds, buildFn)
    {
        if (!Array.isArray(agentIds) || agentIds.length === 0)
        {
            useUiStore.getState().addToast('Select agents to control', 'error')
            return
        }

        const store = usePermissionStore.getState()
        for (const id of agentIds)
        {
            const status = store.getStatus(id, feature)
            if (status === 'granted')
            {
                try { sendCommand(buildFn(id)) }
                catch (err) { console.warn('[batchGuardedSend] send failed:', err) }
                continue
            }

            // Queue this agent's send, then ask it for consent. Re-arm the timer
            // if the agent was already queued (last click wins its build/timeout).
            const prev = pending.current.get(id)
            if (prev) clearTimeout(prev.timer)
            const timer = setTimeout(function () { pending.current.delete(id) }, BATCH_CONSENT_TIMEOUT_MS)
            pending.current.set(id, { feature, buildFn, timer })

            // Only send a fresh request when we are not already waiting on this
            // (agent, feature) — avoids a duplicate popup during Strict-Mode
            // remounts or a second click while the first is still pending.
            if (status !== 'requesting') requestPermission(feature, id)
        }
    }, [sendCommand, requestPermission])
}
