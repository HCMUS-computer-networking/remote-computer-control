/* ApplicationTab — shows the app list for the focused agent.
   Lets the operator start / stop apps that are in WHITELISTED_APPS.
   All others are shown but their buttons are disabled.                */
import { useState, useEffect } from 'react'
import { ChevronUp, ChevronDown } from 'lucide-react'

import useModuleStore from '../../../store/ModuleStore'
import useAgentSocket from '../../../hooks/UseAgentSocket'
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

// Columns that can be sorted — key must match the field name in the app object.
const COLUMNS =
[
    { key: 'display_name', label: 'App Name',  numeric: false },
    { key: 'status',       label: 'Status',    numeric: false },
    { key: 'cpu_percent',  label: 'CPU %',     numeric: true  },
    { key: 'ram_mb',       label: 'RAM (MB)',  numeric: true  },
]

function ApplicationTab({ agent })
{
    // sendToFocused auto-injects [focused_agent_id] into target_agents,
    // so tabs never need to thread agent.id into every builder call.
    const { sendToFocused } = useAgentSocket()

    // Select only this agent's app slice — no re-render when other agents update.
    // EMPTY_APPS (module-level const) keeps the reference stable when data is absent.
    const apps = useModuleStore((s) => s.data[agent.id]?.app ?? EMPTY_APPS)

    // Client-side sort state — UI concern only, not persisted in any store.
    const [sort_col, setSortCol] = useState('display_name')
    const [sort_dir, setSortDir] = useState('asc')

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

    // Click a column header: toggle direction if already active; switch + reset dir otherwise.
    function handleSortClick(col_key)
    {
        if (col_key === sort_col)
        {
            setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
        }
        else
        {
            setSortCol(col_key)
            setSortDir('desc')
        }
    }

    // Sort a COPY of the store slice — never mutate the original array.
    const sorted_apps = [...apps].sort(function (a, b)
    {
        const a_val = a[sort_col]
        const b_val = b[sort_col]

        if (typeof a_val === 'string')
        {
            return sort_dir === 'asc'
                ? a_val.localeCompare(b_val)
                : b_val.localeCompare(a_val)
        }

        return sort_dir === 'asc' ? a_val - b_val : b_val - a_val
    })

    function handleStart(app_name)
    {
        sendToFocused(buildAppStart(app_name))
    }

    function handleStop(app_name)
    {
        sendToFocused(buildAppStop(app_name))
    }

    return (
        <div className="module-table">

            {/* ── toolbar ──────────────────────────────────────────── */}
            <div className="module-table__toolbar">
                <span className="module-table__title">
                    Applications — {agent.name}
                </span>
                <span className="module-table__poll-badge">● Live</span>
            </div>

            {/* ── scrollable table ─────────────────────────────────── */}
            <div className="module-table__scroll">
                <table>
                    <thead>
                        <tr>
                            {COLUMNS.map(function ({ key, label, numeric })
                            {
                                const is_active  = sort_col === key
                                const SortIcon   = sort_dir === 'asc' ? ChevronUp : ChevronDown
                                const th_classes = [
                                    'module-table__th',
                                    'module-table__th--sortable',
                                    is_active ? 'module-table__th--active' : '',
                                    numeric   ? 'module-table__th--num'    : '',
                                ].filter(Boolean).join(' ')

                                return (
                                    <th
                                        key={key}
                                        className={th_classes}
                                        onClick={() => handleSortClick(key)}
                                        title={`Sort by ${label}`}
                                    >
                                        <span className="module-table__th-inner">
                                            {label}
                                            {is_active && (
                                                <SortIcon size={12} strokeWidth={2} />
                                            )}
                                        </span>
                                    </th>
                                )
                            })}
                            <th className="module-table__th module-table__th--action">
                                <span className="module-table__th-inner">Action</span>
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {sorted_apps.map(function (app)
                        {
                            const is_whitelisted = WHITELISTED_APPS.has(app.name)
                            const is_running     = app.status === 'running'

                            // Tooltip explains why a button is disabled.
                            const disabled_tip = 'Not in whitelist — action blocked'

                            return (
                                <tr key={app.name} className="module-table__row">

                                    <td className="module-table__td module-table__td--name">
                                        {app.display_name}
                                    </td>

                                    <td className="module-table__td">
                                        <span className={`module-table__badge module-table__badge--${app.status}`}>
                                            {app.status}
                                        </span>
                                    </td>

                                    <td className="module-table__td module-table__td--num">
                                        {app.cpu_percent.toFixed(1)}
                                    </td>

                                    <td className="module-table__td module-table__td--num">
                                        {app.ram_mb}
                                    </td>

                                    <td className="module-table__td module-table__td--action">
                                        {is_running
                                            ? (
                                                <button
                                                    className="action-btn action-btn--stop"
                                                    disabled={!is_whitelisted}
                                                    title={is_whitelisted ? 'Stop this application' : disabled_tip}
                                                    onClick={() => handleStop(app.name)}
                                                >
                                                    Stop
                                                </button>
                                            )
                                            : (
                                                <button
                                                    className="action-btn action-btn--start"
                                                    disabled={!is_whitelisted}
                                                    title={is_whitelisted ? 'Start this application' : disabled_tip}
                                                    onClick={() => handleStart(app.name)}
                                                >
                                                    Start
                                                </button>
                                            )
                                        }
                                    </td>

                                </tr>
                            )
                        })}
                    </tbody>
                </table>

                {apps.length === 0 && (
                    <div className="module-table__empty">Loading application list…</div>
                )}
            </div>

        </div>
    )
}

export default ApplicationTab
