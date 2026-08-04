/* ApplicationTab — shows the app list for the focused agent.
   Thin wrapper around <ModuleTable />: declares the columns and the Start/Stop
   action renderer. The whitelist is NOT hard-coded here — it comes from the
   security policy the Controller pushed (PolicyStore) and the per-app
   in_whitelist flag the Agent returns. Sort state, toolbar, empty state, and
   scroll container all live in ModuleTable.                                    */
import { useEffect, useMemo } from 'react'

import useModuleStore     from '../../../store/ModuleStore'
import useConnectionStore from '../../../store/ConnectionStore'
import usePolicyStore     from '../../../store/PolicyStore'
import useAgentSocket     from '../../../hooks/UseAgentSocket'
import ModuleTable        from '../../ModuleTable'
import { useGuardedSend, usePendingConsent } from '../../PermissionGate'
import { buildAppList, buildAppStart, buildAppStop } from '../../../services/Protocol'

// How often the tab asks the agent for a fresh snapshot (makes % look live).
const POLL_INTERVAL_MS = 3000

// Stable empty array used as the fallback when the store has no data yet.
// Using a module-level constant avoids creating a new [] reference on every
// selector call, which would trigger an infinite re-render loop in Zustand.
const EMPTY_APPS = []

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
    const guardedSend       = useGuardedSend()
    const is_pending        = usePendingConsent()

    // Select only this agent's app slice — no re-render when other agents update.
    // EMPTY_APPS (module-level const) keeps the reference stable when data is absent.
    const apps = useModuleStore((s) => s.data[agent.id]?.app ?? EMPTY_APPS)

    // Connection status drives the empty-state message (loading vs disconnected).
    const conn_status = useConnectionStore((s) => s.status)

    // Whitelist sourced from the pushed security policy (NOT hard-coded).
    // Used as a fallback when an app row has no in_whitelist flag.
    const app_whitelist = usePolicyStore((s) => s.app_whitelist)
    const whitelist_set = useMemo(() => new Set(app_whitelist), [app_whitelist])

    // Fetch on mount; refresh every POLL_INTERVAL_MS for live-looking numbers.
    // Effect re-runs if the user focuses a different agent (agent.id changes).
    // Skip polling entirely for offline agents — they cannot answer.
    useEffect(function ()
    {
        if (!agent.online) return

        // Wrap the FIRST fetch so opening the tab auto-triggers the consent
        // popup. Later polls skip the wrapper — the socket layer already
        // filters ungranted messages, so extra guardedSend calls each 3s
        // would just enqueue duplicate sendFns.
        guardedSend(function () { sendToFocused(buildAppList()) })

        const timer = setInterval(function ()
        {
            sendToFocused(buildAppList(), { silent: true })                                         // Poll tick — suppress the "N agents not granted" toast so the operator isn't spammed every 3 s

        }, POLL_INTERVAL_MS)

        return () => clearInterval(timer)   // stop polling when tab unmounts or agent changes
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [agent.id, agent.online])

    // Friendly empty state: distinguish offline agent, dead link, and loading.
    const empty_label = !agent.online     ? 'Agent is offline'
                      : conn_status !== 'open' ? 'Gateway disconnected — waiting to reconnect…'
                      :                        'Loading application list…'

    // Action column renderer — Start or Stop depending on current status,
    // disabled entirely for apps outside the pushed policy whitelist.
    // Prefer the Agent's in_whitelist flag; fall back to the policy set.
    function renderAction(row)
    {
        const is_whitelisted = row.in_whitelist ?? whitelist_set.has(row.name)
        const is_running     = row.status === 'running'
        const disabled_tip   = 'Not in whitelist — action blocked'

        if (is_running)
        {
            return (
                <button
                    className="action-btn action-btn--stop"
                    disabled={!is_whitelisted || is_pending}
                    title={is_pending ? 'Đang xin quyền...' : is_whitelisted ? 'Stop this application' : disabled_tip}
                    onClick={() => guardedSend(() => sendToFocused(buildAppStop(row.name)))}
                >
                    Stop
                </button>
            )
        }

        return (
            <button
                className="action-btn action-btn--start"
                disabled={!is_whitelisted || is_pending}
                title={is_pending ? 'Đang xin quyền...' : is_whitelisted ? 'Start this application' : disabled_tip}
                onClick={() => guardedSend(() => sendToFocused(buildAppStart(row.name)))}
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
            empty_label={empty_label}
            title={`Applications — ${agent.name}`}
            poll_badge={agent.online}
            row_key={(row) => row.name}
        />
    )
}

export default ApplicationTab
