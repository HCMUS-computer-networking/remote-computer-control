/* ProcessTab — shows all running processes for the focused agent.
   Thin wrapper around <ModuleTable />: declares the columns and a Kill action
   for every row. Sort state, toolbar, empty state, and scroll container all
   live in ModuleTable.                                                          */
import { useEffect } from 'react'

import useModuleStore from '../../../store/ModuleStore'
import useAgentSocket from '../../../hooks/UseAgentSocket'
import ModuleTable    from '../../ModuleTable'
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

    // Fetch on mount; refresh every POLL_INTERVAL_MS.
    // Re-runs when the focused agent changes.
    useEffect(function ()
    {
        sendToFocused(buildProcList())

        const timer = setInterval(function ()
        {
            sendToFocused(buildProcList())
        }, POLL_INTERVAL_MS)

        return () => clearInterval(timer)
    }, [agent.id])

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
            empty_label="Loading process list…"
            title={`Processes — ${agent.name}`}
            poll_badge
            row_key={(row) => row.pid}
        />
    )
}

export default ProcessTab
