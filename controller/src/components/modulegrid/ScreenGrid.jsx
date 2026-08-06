// ScreenGrid.jsx — live screen thumbnails for every connected agent. Replaces the
// old GridView. Only agents that GRANTED the screen feature are streamed (at a low
// 2 fps), so a fresh login never fan-outs stream requests to un-granted agents
// (which used to raise the "skipped N agents" toast). Start/Stop act on the
// SELECTED agents and drive the per-agent consent popup.

import { useEffect, useRef } from 'react'
import { MonitorPlay, Square, Loader2 } from 'lucide-react'

import useAgentStore   from '../../store/AgentStore'
import useModuleStore  from '../../store/ModuleStore'
import useE2EEStore    from '../../store/E2EEStore'
import useConnectionStore from '../../store/ConnectionStore'
import usePermissionStore from '../../store/PermissionStore'
import useAgentSocket  from '../../hooks/UseAgentSocket'
import useBatchGuardedSend from '../../hooks/useBatchGuardedSend'
import { buildStreamStart, buildStreamStop, FEATURE } from '../../services/Protocol'
import FrameCanvas     from '../FrameCanvas'
import ModuleGridShell from './ModuleGridShell'

const GRID_FPS     = 2
const GRID_QUALITY = 50

function ScreenTile({ agent })
{
    const frame_meta = useModuleStore((s) => s.data[agent.id]?.screen?.meta ?? null)
    const status     = usePermissionStore((s) => s.permissions[agent.id]?.[FEATURE.SCREEN] ?? 'idle')
    const e2ee_state = useE2EEStore((s) => s.sessions[agent.id]?.state ?? 'uninitialized')

    if (status !== 'granted')
    {
        return <div className="mg-tile__nogrant">Not authorized</div>
    }
    if (e2ee_state !== 'ready')
    {
        return (
            <div className="mg-tile__placeholder">
                <Loader2 size={20} className="spin" /> E2EE…
            </div>
        )
    }
    if (frame_meta)
    {
        return <FrameCanvas agent_id={agent.id} module="screen" width="100%" height="100%" />
    }
    return <div className="mg-tile__placeholder">Waiting for video…</div>
}

function ScreenGrid()
{
    const { sendCommand } = useAgentSocket()
    const batchSend       = useBatchGuardedSend()
    const agents          = useAgentStore((s) => s.agents)
    const selected_ids    = useAgentStore((s) => s.selected_agent_ids)
    const permissions     = usePermissionStore((s) => s.permissions)
    const conn_status     = useConnectionStore((s) => s.status)

    const online_agents = agents.filter((a) => a.online)
    const targets  = selected_ids.filter((id) => online_agents.some((a) => a.id === id))
    const disabled = targets.length === 0

    // Auto-stream ONLY agents that granted screen. Keyed so the effect restarts
    // when the granted set changes (e.g. a selected agent just accepted consent).
    const granted_ids  = online_agents.filter((a) => permissions[a.id]?.[FEATURE.SCREEN] === 'granted').map((a) => a.id)
    const granted_key  = granted_ids.slice().sort().join(',')
    const started_ref  = useRef([])

    useEffect(function ()
    {
        if (conn_status !== 'open' || granted_key === '') return
        const ids = granted_key.split(',')
        sendCommand(buildStreamStart(GRID_FPS, GRID_QUALITY, ids))
        started_ref.current = ids
        return function ()
        {
            if (started_ref.current.length > 0)
            {
                sendCommand(buildStreamStop(started_ref.current))
                started_ref.current = []
            }
        }
    }, [conn_status, granted_key])

    function handleStart()
    {
        batchSend(FEATURE.SCREEN, targets, (id) => buildStreamStart(GRID_FPS, GRID_QUALITY, [id]))
    }

    function handleStop()
    {
        for (const id of targets) sendCommand(buildStreamStop([id]))
    }

    const toolbar = (
        <>
            <button className="screen-tab__btn screen-tab__btn--primary" onClick={handleStart} disabled={disabled}
                title={disabled ? 'Select agents to control' : 'View screen of selected agents'}>
                <MonitorPlay size={14} strokeWidth={2} /> View ({targets.length})
            </button>
            <button className="screen-tab__btn screen-tab__btn--danger" onClick={handleStop} disabled={disabled}
                title={disabled ? 'Select agents to control' : 'Stop viewing selected agents'}>
                <Square size={14} strokeWidth={2} /> Stop
            </button>
        </>
    )

    return (
        <ModuleGridShell
            title="Live Screen — all agents"
            hint="Actions apply to selected agents · only authorized agents show video (2 fps)"
            toolbar={toolbar}
            renderTile={(agent) => <ScreenTile agent={agent} />}
        />
    )
}

export default ScreenGrid
