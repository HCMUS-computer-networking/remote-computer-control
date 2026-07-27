/* ApplicationTab — shows the app list for the focused agent.
   Thin wrapper around <ModuleTable />: declares the columns, WHITELISTED_APPS,
   and the Start/Stop action renderer. Sort state, toolbar, empty state, and
   scroll container all live in ModuleTable.                                    */
import { useEffect } from 'react'

import useModuleStore from '../../../store/ModuleStore'
import useAgentSocket from '../../../hooks/UseAgentSocket'
import ModuleTable    from '../../ModuleTable'
import { buildAppList, buildAppStart, buildAppStop } from '../../../services/Protocol'

// How often the tab asks the agent for a fresh snapshot (makes % look live).
const POLL_INTERVAL_MS = 3000

// Stable empty array used as the fallback when the store has no data yet.
// Using a module-level constant avoids creating a new [] reference on every
// selector call, which would trigger an infinite re-render loop in Zustand.
const EMPTY_APPS = []

// App names the Controller is allowed to start or stop.
// Must match the "name" field (short exe name) in app_list_result from the Agent.
// Apps NOT in this set are shown in the table but their buttons stay disabled.
const WHITELISTED_APPS = new Set(['notepad', 'calc', 'mspaint', 'chrome', 'vlc'])

// Column definitions passed to ModuleTable.
// Only display_name and status use custom renderers; numeric cells fall back
// to row[key] which prints the raw number.
const COLUMNS =
[
    { key: 'display_name', label: 'App Name',  numeric: false },
    {
        key: 'status',
        label: 'Status',
        numeric: false,
        render: (row) => (
            <span className={`module-table__badge module-table__badge--${row.status}`}>
                {row.status}
            </span>
        ),
    },
    {
        key: 'cpu_percent',
        label: 'CPU %',
        numeric: true,
        render: (row) => row.cpu_percent.toFixed(1),
    },
    { key: 'ram_mb', label: 'RAM (MB)', numeric: true },
]

function ApplicationTab({ agent })
{
    // sendToFocused auto-injects [focused_agent_id] into target_agents,
    // so tabs never need to thread agent.id into every builder call.
    const { sendToFocused } = useAgentSocket()

    // Select only this agent's app slice — no re-render when other agents update.
    // EMPTY_APPS (module-level const) keeps the reference stable when data is absent.
    const apps = useModuleStore((s) => s.data[agent.id]?.app ?? EMPTY_APPS)

    // Fetch on mount; refresh every POLL_INTERVAL_MS for live-looking numbers.
    // Effect re-runs if the user focuses a different agent (agent.id changes).
    useEffect(function ()
    {
        sendToFocused(buildAppList())

        const timer = setInterval(function ()
        {
            sendToFocused(buildAppList())
        }, POLL_INTERVAL_MS)

        return () => clearInterval(timer)   // stop polling when tab unmounts or agent changes
    }, [agent.id])

    // Action column renderer — Start or Stop depending on current status,
    // disabled entirely for apps outside WHITELISTED_APPS.
    function renderAction(row)
    {
        const is_whitelisted = WHITELISTED_APPS.has(row.name)
        const is_running     = row.status === 'running'
        const disabled_tip   = 'Not in whitelist — action blocked'

        if (is_running)
        {
            return (
                <button
                    className="action-btn action-btn--stop"
                    disabled={!is_whitelisted}
                    title={is_whitelisted ? 'Stop this application' : disabled_tip}
                    onClick={() => sendToFocused(buildAppStop(row.name))}
                >
                    Stop
                </button>
            )
        }

        return (
            <button
                className="action-btn action-btn--start"
                disabled={!is_whitelisted}
                title={is_whitelisted ? 'Start this application' : disabled_tip}
                onClick={() => sendToFocused(buildAppStart(row.name))}
            >
                Start
            </button>
        )
    }

    return (
        <ModuleTable
            columns={COLUMNS}
            rows={apps}
            actionColumn={{ header: 'Action', render: renderAction }}
            empty_label="Loading application list…"
            title={`Applications — ${agent.name}`}
            poll_badge
            row_key={(row) => row.name}
        />
    )
}

export default ApplicationTab
