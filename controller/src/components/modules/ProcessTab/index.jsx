/* ProcessTab — shows all running processes for the focused agent.
   Supports client-side sort by any column; Kill button on every row. */
import { useState, useEffect } from 'react'
import { ChevronUp, ChevronDown } from 'lucide-react'

import useModuleStore from '../../../store/ModuleStore'
import useAgentSocket from '../../../hooks/UseAgentSocket'
import { buildProcList, buildProcKill } from '../../../services/Protocol'

// How often the tab polls for a fresh process snapshot.
const POLL_INTERVAL_MS = 3000

// Stable empty fallback — prevents a new [] from being returned on every selector
// call, which would trigger Zustand's infinite re-render detection.
const EMPTY_PROCS = []

// Columns that can be sorted — key must match the field name in the process object.
const COLUMNS =
[
    { key: 'name',        label: 'Process Name', numeric: false },
    { key: 'pid',         label: 'PID',          numeric: true  },
    { key: 'cpu_percent', label: 'CPU %',         numeric: true  },
    { key: 'ram_mb',      label: 'RAM (MB)',       numeric: true  },
]

function ProcessTab({ agent })
{
    // sendToFocused auto-injects [focused_agent_id] into target_agents,
    // so tabs never need to thread agent.id into every builder call.
    const { sendToFocused } = useAgentSocket()

    // Select only this agent's process slice — avoids re-render for other agents.
    // EMPTY_PROCS keeps the selector return value stable when no data exists yet.
    const procs = useModuleStore((s) => s.data[agent.id]?.process ?? EMPTY_PROCS)

    // Client-side sort state — UI concern only, not persisted in any store.
    const [sort_col, setSortCol] = useState('cpu_percent')   // active sort column key
    const [sort_dir, setSortDir] = useState('desc')          // 'asc' or 'desc'

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
            setSortDir('desc')   // always start desc on a freshly selected column
        }
    }

    // Sort a COPY of the store slice — never mutate the original array.
    const sorted_procs = [...procs].sort(function (a, b)
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

    function handleKill(pid)
    {
        sendToFocused(buildProcKill(pid))
    }

    return (
        <div className="module-table">

            {/* ── toolbar ──────────────────────────────────────────── */}
            <div className="module-table__toolbar">
                <span className="module-table__title">
                    Processes — {agent.name}
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
                                            {/* show sort icon only on the active column */}
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
                        {sorted_procs.map(function (proc)
                        {
                            return (
                                <tr key={proc.pid} className="module-table__row">

                                    <td className="module-table__td module-table__td--name">
                                        {proc.name}
                                    </td>

                                    <td className="module-table__td module-table__td--num">
                                        {proc.pid}
                                    </td>

                                    <td className="module-table__td module-table__td--num">
                                        {proc.cpu_percent.toFixed(1)}
                                    </td>

                                    <td className="module-table__td module-table__td--num">
                                        {proc.ram_mb.toFixed(0)}
                                    </td>

                                    <td className="module-table__td module-table__td--action">
                                        <button
                                            className="action-btn action-btn--kill"
                                            onClick={() => handleKill(proc.pid)}
                                            title={`Kill PID ${proc.pid}`}
                                        >
                                            Kill
                                        </button>
                                    </td>

                                </tr>
                            )
                        })}
                    </tbody>
                </table>

                {sorted_procs.length === 0 && (
                    <div className="module-table__empty">Loading process list…</div>
                )}
            </div>

        </div>
    )
}

export default ProcessTab
