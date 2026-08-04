/* ProcessTab — shows all running processes for the focused agent.
   Thin wrapper around <ModuleTable />: declares the columns and a Kill action
   for every row. Sort state, toolbar, empty state, and scroll container all
   live in ModuleTable.                                                          */
import { useEffect, useState } from 'react'

import useModuleStore     from '../../../store/ModuleStore'
import useConnectionStore from '../../../store/ConnectionStore'
import useUiStore         from '../../../store/UiStore'
import useAgentSocket     from '../../../hooks/UseAgentSocket'
import ModuleTable        from '../../ModuleTable'
import { useGuardedSend, usePendingConsent } from '../../PermissionGate'
import { buildProcList, buildProcKill } from '../../../services/Protocol'

// How often the tab polls for a fresh process snapshot.
const POLL_INTERVAL_MS = 3000

// Stable empty fallback — prevents a new [] from being returned on every selector
// call, which would trigger Zustand's infinite re-render detection.
const EMPTY_PROCS = []

// Column definitions passed to ModuleTable.
// Numeric columns without a render fall back to the raw row[key] value.
const COLUMNS =
[
    { key: 'name',        label: 'Process Name', numeric: false },
    { key: 'pid',         label: 'PID',          numeric: true  },
    {
        key: 'cpu_percent',
        label: 'CPU %',
        numeric: true,
        render: (row) => row.cpu_percent.toFixed(1),
    },
    {
        key: 'ram_mb',
        label: 'RAM (MB)',
        numeric: true,
        render: (row) => row.ram_mb.toFixed(0),
    },
]

function ProcessTab({ agent })
{
    // sendToFocused auto-injects [focused_agent_id] into target_agents,
    // so tabs never need to thread agent.id into every builder call.
    const { sendToFocused } = useAgentSocket()
    const addToast          = useUiStore((s) => s.addToast)
    const guardedSend       = useGuardedSend()
    const is_pending        = usePendingConsent()

    // ── Manual "Kill by PID" form ─────────────────────────────────────────
    // Validate inline: integer strictly greater than 0. Empty is not an
    // error yet (user hasn't typed) — the submit button just stays disabled.
    const [pid_input,  setPidInput] = useState('')
    const trimmed_pid = pid_input.trim()
    const parsed_pid  = /^\d+$/.test(trimmed_pid) ? parseInt(trimmed_pid, 10) : NaN
    const pid_valid   = Number.isInteger(parsed_pid) && parsed_pid > 0
    const pid_error   = trimmed_pid === ''
        ? ''
        : (pid_valid ? '' : 'PID phải là số nguyên dương')

    function handleManualKill(e)
    {
        e.preventDefault()
        if (!pid_valid) return
        guardedSend(function ()
        {
            try
            {
                sendToFocused(buildProcKill(parsed_pid))
                setPidInput('')
            }
            catch (err)
            {
                // Defense-in-depth: builder threw despite our UI check.
                addToast(err.message ?? 'Failed to build proc_kill request', 'error')
            }
        })
    }

    // Select only this agent's process slice — avoids re-render for other agents.
    // EMPTY_PROCS keeps the selector return value stable when no data exists yet.
    const procs = useModuleStore((s) => s.data[agent.id]?.process ?? EMPTY_PROCS)

    // Connection status drives the empty-state message (loading vs disconnected).
    const conn_status = useConnectionStore((s) => s.status)

    // Fetch on mount; refresh every POLL_INTERVAL_MS.
    // Re-runs when the focused agent changes. Offline agents are not polled.
    useEffect(function ()
    {
        if (!agent.online) return

        // Wrap the first fetch so opening the tab auto-triggers the consent
        // popup. Interval ticks skip the wrapper — see ApplicationTab for rationale.
        guardedSend(function () { sendToFocused(buildProcList()) })

        const timer = setInterval(function ()
        {
            sendToFocused(buildProcList(), { silent: true })                                        // Poll tick — suppress the "N agents not granted" toast so the operator isn't spammed every 3 s

        }, POLL_INTERVAL_MS)

        return () => clearInterval(timer)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [agent.id, agent.online])

    // Friendly empty state: distinguish offline agent, dead link, and loading.
    const empty_label = !agent.online     ? 'Agent is offline'
                      : conn_status !== 'open' ? 'Gateway disconnected — waiting to reconnect…'
                      :                        'Loading process list…'

    // Action column renderer — Kill button on every row.
    function renderAction(row)
    {
        return (
            <button
                className="action-btn action-btn--kill"
                onClick={() => guardedSend(() => sendToFocused(buildProcKill(row.pid)))}
                disabled={is_pending}
                title={is_pending ? 'Đang xin quyền...' : `Kill PID ${row.pid}`}
            >
                Kill
            </button>
        )
    }

    return (
        <div>
            {/* Manual "Kill by PID" — for processes not visible in the current list. */}
            <form className="form-inline" onSubmit={handleManualKill}>
                <label htmlFor="proc-kill-pid" className="form-inline__label">Kill by PID:</label>
                <input
                    id="proc-kill-pid"
                    className={`form-inline__input${pid_error ? ' form-inline__input--error' : ''}`}
                    type="number"
                    min="1"
                    step="1"
                    inputMode="numeric"
                    placeholder="e.g. 4321"
                    value={pid_input}
                    onChange={(e) => setPidInput(e.target.value)}
                    disabled={!agent.online}
                    aria-invalid={Boolean(pid_error)}
                    aria-describedby={pid_error ? 'proc-kill-pid-error' : undefined}
                />
                <button
                    type="submit"
                    className="action-btn action-btn--kill"
                    disabled={!pid_valid || !agent.online || is_pending}
                    title={is_pending ? 'Đang xin quyền...' : pid_valid ? `Kill PID ${parsed_pid}` : 'Enter a positive integer PID first'}
                >
                    Kill
                </button>
                {pid_error && (
                    <span id="proc-kill-pid-error" className="form-inline__error">{pid_error}</span>
                )}
            </form>

            <ModuleTable
                columns={COLUMNS}
                rows={procs}
                actionColumn={{ header: 'Action', render: renderAction }}
                empty_label={empty_label}
                title={`Processes — ${agent.name}`}
                poll_badge={agent.online}
                row_key={(row) => row.pid}
            />
        </div>
    )
}

export default ProcessTab
