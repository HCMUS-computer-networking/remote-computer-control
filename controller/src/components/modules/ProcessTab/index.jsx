/* ProcessTab — shows all running processes for the focused agent.
   Thin wrapper around <ModuleTable />: declares the columns and a Kill action
   for every row. Sort state, toolbar, empty state, and scroll container all
   live in ModuleTable.                                                          */
import { useEffect } from 'react'

import useModuleStore     from '../../../store/ModuleStore'
import useConnectionStore from '../../../store/ConnectionStore'
import useAgentSocket     from '../../../hooks/UseAgentSocket'
import ModuleTable        from '../../ModuleTable'
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

        sendToFocused(buildProcList())

        const timer = setInterval(function ()
        {
            sendToFocused(buildProcList())
        }, POLL_INTERVAL_MS)

        return () => clearInterval(timer)
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
                onClick={() => sendToFocused(buildProcKill(row.pid))}
                title={`Kill PID ${row.pid}`}
            >
                Kill
            </button>
        )
    }

    return (
        <ModuleTable
            columns={COLUMNS}
            rows={procs}
            actionColumn={{ header: 'Action', render: renderAction }}
            empty_label={empty_label}
            title={`Processes — ${agent.name}`}
            poll_badge={agent.online}
            row_key={(row) => row.pid}
        />
    )
}

export default ProcessTab
