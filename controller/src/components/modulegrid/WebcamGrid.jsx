// WebcamGrid.jsx — webcam feed for every connected agent; Start/Stop act on the
// SELECTED agents. Grid feeds run at a low fps to keep N simultaneous streams cheap.

import { useEffect, useRef } from 'react'
import { Video, VideoOff } from 'lucide-react'

import useAgentStore   from '../../store/AgentStore'
import useModuleStore  from '../../store/ModuleStore'
import useE2EEStore    from '../../store/E2EEStore'
import useAgentSocket  from '../../hooks/UseAgentSocket'
import useBatchGuardedSend from '../../hooks/useBatchGuardedSend'
import usePermissionStore  from '../../store/PermissionStore'
import { buildWebcamStart, buildWebcamStop, FEATURE } from '../../services/Protocol'
import FrameCanvas     from '../FrameCanvas'
import ModuleGridShell from './ModuleGridShell'

const GRID_WEBCAM_FPS     = 5    // low fps — many feeds at once
const GRID_WEBCAM_QUALITY = 50

function WebcamTile({ agent })
{
    const frame_meta    = useModuleStore((s) => s.data[agent.id]?.webcam?.meta  ?? null)
    const webcam_active = useModuleStore((s) => s.data[agent.id]?.webcam_active ?? false)
    const status        = usePermissionStore((s) => s.permissions[agent.id]?.[FEATURE.WEBCAM] ?? 'idle')
    const e2ee_ready    = useE2EEStore((s) => (s.sessions[agent.id]?.state ?? 'uninitialized') === 'ready')

    if (status !== 'granted' && !webcam_active)
    {
        return <div className="mg-tile__nogrant">Not authorized</div>
    }
    if (frame_meta && e2ee_ready)
    {
        return <FrameCanvas agent_id={agent.id} module="webcam" width="100%" height="100%" />
    }
    return <div className="mg-tile__placeholder">Waiting for video…</div>
}

function WebcamGrid()
{
    const { sendCommand } = useAgentSocket()
    const batchSend       = useBatchGuardedSend()
    const agents          = useAgentStore((s) => s.agents)
    const selected_ids    = useAgentStore((s) => s.selected_agent_ids)

    const targets = selected_ids.filter((id) => agents.some((a) => a.id === id && a.online))
    const disabled = targets.length === 0

    // Track the agents we started, so leaving the grid stops their cameras
    // (a lingering webcam = the physical LED stays on — privacy leak).
    const started_ref = useRef(new Set())

    useEffect(function ()
    {
        return function ()
        {
            for (const id of started_ref.current) sendCommand(buildWebcamStop([id]))
            started_ref.current.clear()
        }
    }, [])

    function handleStart()
    {
        for (const id of targets) started_ref.current.add(id)
        batchSend(FEATURE.WEBCAM, targets, (id) => buildWebcamStart(GRID_WEBCAM_FPS, GRID_WEBCAM_QUALITY, [id]))
    }

    function handleStop()
    {
        for (const id of targets)
        {
            sendCommand(buildWebcamStop([id]))
            started_ref.current.delete(id)
        }
    }

    const toolbar = (
        <>
            <button className="screen-tab__btn screen-tab__btn--primary" onClick={handleStart} disabled={disabled}
                title={disabled ? 'Select agents to control' : 'Start webcam on selected agents'}>
                <Video size={14} strokeWidth={2} /> Start ({targets.length})
            </button>
            <button className="screen-tab__btn screen-tab__btn--danger" onClick={handleStop} disabled={disabled}
                title={disabled ? 'Select agents to control' : 'Stop webcam on selected agents'}>
                <VideoOff size={14} strokeWidth={2} /> Stop
            </button>
        </>
    )

    return (
        <ModuleGridShell
            title="Webcam — all agents"
            hint="Actions apply to selected agents · each agent shows its own consent popup + red recording dot"
            toolbar={toolbar}
            renderTile={(agent) => <WebcamTile agent={agent} />}
        />
    )
}

export default WebcamGrid
