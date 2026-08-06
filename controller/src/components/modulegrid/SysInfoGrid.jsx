// SysInfoGrid.jsx — CPU / RAM / Disk snapshot for every connected agent at once.
// SysInfo is read-only (no consent), so there is no batch toolbar — the grid just
// polls every online agent every 2 s and shows a compact tile per machine.

import { useEffect } from 'react'
import { Cpu, MemoryStick, HardDrive } from 'lucide-react'

import useAgentStore     from '../../store/AgentStore'
import useModuleStore    from '../../store/ModuleStore'
import useConnectionStore from '../../store/ConnectionStore'
import useAgentSocket    from '../../hooks/UseAgentSocket'
import { buildSysInfo }  from '../../services/Protocol'
import ModuleGridShell   from './ModuleGridShell'

const POLL_INTERVAL_MS = 2000

// One metric row: label + percent bar + value.
function Metric({ Icon, label, percent, value_text })
{
    const width_pct = Math.max(0, Math.min(100, percent ?? 0))
    return (
        <div className="mg-metric">
            <Icon size={13} strokeWidth={1.75} />
            <span className="mg-metric__label">{label}</span>
            <div className="mg-metric__bar" aria-hidden="true">
                <div className="mg-metric__fill" style={{ width: `${width_pct}%` }} />
            </div>
            <span className="mg-metric__val">{value_text}</span>
        </div>
    )
}

function SysInfoTile({ agent })
{
    const snapshot = useModuleStore((s) => s.data[agent.id]?.sysinfo ?? null)

    if (!snapshot)
    {
        return <div className="mg-tile__placeholder">Loading metrics…</div>
    }

    const cpu  = snapshot.cpu_percent ?? 0
    const ram  = snapshot.ram_total_mb  > 0 ? (snapshot.ram_used_mb  / snapshot.ram_total_mb)  * 100 : 0
    const disk = snapshot.disk_total_gb > 0 ? (snapshot.disk_used_gb / snapshot.disk_total_gb) * 100 : 0

    return (
        <div className="mg-sysinfo">
            <Metric Icon={Cpu}         label="CPU"  percent={cpu}  value_text={`${cpu.toFixed(0)}%`} />
            <Metric Icon={MemoryStick} label="RAM"  percent={ram}  value_text={`${ram.toFixed(0)}%`} />
            <Metric Icon={HardDrive}   label="Disk" percent={disk} value_text={`${disk.toFixed(0)}%`} />
            <div className="mg-sysinfo__meta">{snapshot.os || '—'} · {snapshot.ip || '—'}</div>
        </div>
    )
}

function SysInfoGrid()
{
    const { sendCommand } = useAgentSocket()
    const agents          = useAgentStore((s) => s.agents)
    const conn_status     = useConnectionStore((s) => s.status)

    // Stable key of online ids so the poll effect restarts when the SET changes.
    const online_ids_key = agents.filter((a) => a.online).map((a) => a.id).sort().join(',')

    useEffect(function ()
    {
        if (conn_status !== 'open' || online_ids_key === '') return
        const online_ids = online_ids_key.split(',')

        // One request carrying all targets — sendCommand fans it out per agent.
        // sysinfo needs no consent so nothing is skipped.
        sendCommand(buildSysInfo(online_ids))
        const timer = setInterval(function ()
        {
            sendCommand(buildSysInfo(online_ids))
        }, POLL_INTERVAL_MS)

        return () => clearInterval(timer)
    }, [conn_status, online_ids_key])

    return (
        <ModuleGridShell
            title="System Info — all agents"
            hint="Read-only · auto-refreshes every 2s · no consent required"
            renderTile={(agent) => <SysInfoTile agent={agent} />}
        />
    )
}

export default SysInfoGrid
