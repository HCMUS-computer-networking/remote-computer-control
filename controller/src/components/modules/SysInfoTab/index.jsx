/* SysInfoTab — read-only dashboard of CPU / RAM / Disk for the focused agent.
   Polls `sysinfo` every 2 seconds; each reply is appended to a rolling 60-point
   history in ModuleStore, which drives three sparkline charts. No consent flow:
   sysinfo carries no sensitive data so FocusView bypasses PermissionGate.       */
import { useEffect } from 'react'
import { Cpu, MemoryStick, HardDrive } from 'lucide-react'
import { LineChart, Line, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

import useModuleStore     from '../../../store/ModuleStore'
import useConnectionStore from '../../../store/ConnectionStore'
import useAgentSocket     from '../../../hooks/UseAgentSocket'
import { buildSysInfo }   from '../../../services/Protocol'

// How often the tab polls for a fresh system snapshot. 2s balances freshness
// with wire pressure (a full JSON is ~200 bytes per agent per tick).
const POLL_INTERVAL_MS = 2000

// Stable empty fallback — prevents a new [] from being returned on every
// selector call, which would trigger Zustand's infinite re-render detection.
const EMPTY_HISTORY = []

// Format seconds into a compact "1d 03h 12m" string for the uptime line.
function formatUptime(total_seconds)
{
    if (!total_seconds || total_seconds < 0) return '—'
    const days    = Math.floor(total_seconds / 86400)
    const hours   = Math.floor((total_seconds % 86400) / 3600)
    const minutes = Math.floor((total_seconds % 3600) / 60)
    if (days > 0)    return `${days}d ${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m`
    if (hours > 0)   return `${hours}h ${String(minutes).padStart(2, '0')}m`
    return `${minutes}m`
}

// One-decimal percent formatter — used in tooltips and current-value labels.
function formatPercent(v)
{
    return `${(v ?? 0).toFixed(1)}%`
}

// Convert MB to a compact GB string (RAM lives around 8–32 GB on real hardware).
function formatGbFromMb(mb)
{
    return `${((mb ?? 0) / 1024).toFixed(1)} GB`
}

// One stat tile: icon + label + big current value + percent bar + secondary hint.
// Kept local to this file — it is a private layout helper, not a shared building block.
function StatTile({ Icon, label, value_text, hint_text, percent })
{
    // Clamp the fill width so a bad number never overflows the bar visually.
    const width_pct = Math.max(0, Math.min(100, percent ?? 0))

    return (
        <div className="sysinfo-tile">
            <div className="sysinfo-tile__header">
                <Icon size={16} strokeWidth={1.75} />
                <span className="sysinfo-tile__label">{label}</span>
            </div>
            <div className="sysinfo-tile__value">{value_text}</div>
            <div className="sysinfo-tile__bar" aria-hidden="true">
                <div className="sysinfo-tile__bar-fill" style={{ width: `${width_pct}%` }} />
            </div>
            <div className="sysinfo-tile__hint">{hint_text}</div>
        </div>
    )
}

// One mini line chart. Shares y-domain [0..100] so all three sparklines are
// directly comparable at a glance. The parent controls the height via CSS.
function MiniChart({ data, data_key, color, title })
{
    return (
        <div className="sysinfo-chart">
            <div className="sysinfo-chart__title">{title}</div>
            <div className="sysinfo-chart__body">
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                        <YAxis domain={[0, 100]} hide />
                        <Tooltip
                            formatter={(v) => formatPercent(v)}
                            labelFormatter={() => ''}
                            contentStyle={{
                                background : 'var(--bg-elevated)',
                                border     : '1px solid var(--gray-200)',
                                fontSize   : '0.75rem',
                            }}
                        />
                        <Line
                            type="monotone"
                            dataKey={data_key}
                            stroke={color}
                            strokeWidth={2}
                            dot={false}
                            isAnimationActive={false}
                        />
                    </LineChart>
                </ResponsiveContainer>
            </div>
        </div>
    )
}

function SysInfoTab({ agent })
{
    const { sendToFocused } = useAgentSocket()

    // Subscribe to only this agent's sysinfo slice so other agents' updates
    // do not re-render the dashboard.
    const snapshot = useModuleStore((s) => s.data[agent.id]?.sysinfo ?? null)
    const history  = useModuleStore((s) => s.data[agent.id]?.sysinfo_history ?? EMPTY_HISTORY)

    // Connection status drives the empty-state message (loading vs disconnected).
    const conn_status = useConnectionStore((s) => s.status)

    // Poll every POLL_INTERVAL_MS while this tab is mounted. Cleanup on unmount
    // (tab switch, agent change, logout) stops the interval — no leaked timers.
    useEffect(function ()
    {
        if (!agent.online) return

        sendToFocused(buildSysInfo())

        const timer = setInterval(function ()
        {
            sendToFocused(buildSysInfo(), { silent: true })                                         // Poll tick — suppress the "N agents not granted" toast so the operator isn't spammed every 3 s

        }, POLL_INTERVAL_MS)

        return () => clearInterval(timer)
    }, [agent.id, agent.online])

    // Derived percentages for the stat tiles — safe when snapshot is null.
    const cpu_percent  = snapshot?.cpu_percent ?? 0
    const ram_percent  = snapshot && snapshot.ram_total_mb  > 0
        ? (snapshot.ram_used_mb  / snapshot.ram_total_mb)  * 100
        : 0
    const disk_percent = snapshot && snapshot.disk_total_gb > 0
        ? (snapshot.disk_used_gb / snapshot.disk_total_gb) * 100
        : 0

    // Friendly empty-state message covers offline / disconnected / loading.
    const empty_label = !agent.online          ? 'Agent is offline'
                      : conn_status !== 'open' ? 'Gateway disconnected — waiting to reconnect…'
                      : !snapshot              ? 'Loading system metrics…'
                      : null

    return (
        <div className="sysinfo-tab">

            {/* ── Header row: title + host info (hostname / OS / IP / uptime) ── */}
            <div className="sysinfo-tab__header">
                <div className="sysinfo-tab__title">System — {agent.name}</div>
                {snapshot && (
                    <div className="sysinfo-tab__meta">
                        <span title="Hostname">{snapshot.hostname || agent.name}</span>
                        <span className="sysinfo-tab__meta-sep">·</span>
                        <span title="OS">{snapshot.os || '—'}</span>
                        <span className="sysinfo-tab__meta-sep">·</span>
                        <span title="IP address">{snapshot.ip || '—'}</span>
                        <span className="sysinfo-tab__meta-sep">·</span>
                        <span title="Uptime">Uptime: {formatUptime(snapshot.uptime_seconds)}</span>
                    </div>
                )}
            </div>

            {empty_label
                ? <div className="sysinfo-tab__empty">{empty_label}</div>
                : (
                    <>
                        {/* ── Stat tiles — big current numbers ─────────────────── */}
                        <div className="sysinfo-tab__tiles">
                            <StatTile
                                Icon={Cpu}
                                label="CPU"
                                value_text={formatPercent(cpu_percent)}
                                hint_text="Overall CPU load"
                                percent={cpu_percent}
                            />
                            <StatTile
                                Icon={MemoryStick}
                                label="RAM"
                                value_text={formatPercent(ram_percent)}
                                hint_text={`${formatGbFromMb(snapshot.ram_used_mb)} / ${formatGbFromMb(snapshot.ram_total_mb)}`}
                                percent={ram_percent}
                            />
                            <StatTile
                                Icon={HardDrive}
                                label="Disk"
                                value_text={formatPercent(disk_percent)}
                                hint_text={`${(snapshot.disk_used_gb ?? 0).toFixed(1)} GB / ${(snapshot.disk_total_gb ?? 0).toFixed(1)} GB`}
                                percent={disk_percent}
                            />
                        </div>

                        {/* ── Sparkline charts — last 60 samples ───────────────── */}
                        <div className="sysinfo-tab__charts">
                            <MiniChart
                                data={history}
                                data_key="cpu_percent"
                                color="var(--accent)"
                                title="CPU %"
                            />
                            <MiniChart
                                data={history}
                                data_key="ram_percent"
                                color="var(--success)"
                                title="RAM %"
                            />
                            <MiniChart
                                data={history}
                                data_key="disk_percent"
                                color="var(--warning)"
                                title="Disk %"
                            />
                        </div>
                    </>
                )
            }
        </div>
    )
}

export default SysInfoTab
