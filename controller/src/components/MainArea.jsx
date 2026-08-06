// MainArea.jsx — routes the main panel between single-agent Focus and per-module
// multi-agent Grid, driven purely by the current selection (see services/viewMode).
//
//   - Grid module + (0 or ≥2 selected) → that module's Grid (all connected agents).
//   - Grid module + exactly 1 selected  → Focus of that agent.
//   - File / Application / Process       → always Focus.
//
// In Focus mode we keep AgentStore.focused_agent_id in sync with the intent so
// FocusView (unchanged) renders the right machine.

import { useEffect } from 'react'

import useUiStore    from '../store/UiStore'
import useAgentStore from '../store/AgentStore'
import { deriveViewMode } from '../services/viewMode'

import ModuleTabs  from './ModuleTabs'
import FocusView   from './livescreen/FocusView'
import SysInfoGrid from './modulegrid/SysInfoGrid'
import KeylogGrid  from './modulegrid/KeylogGrid'
import WebcamGrid  from './modulegrid/WebcamGrid'
import PowerGrid   from './modulegrid/PowerGrid'
import ScreenGrid  from './modulegrid/ScreenGrid'

const GRIDS =
{
    sysinfo : SysInfoGrid,
    keylog  : KeylogGrid,
    webcam  : WebcamGrid,
    power   : PowerGrid,
    screen  : ScreenGrid,
}

function MainArea()
{
    const active_tab       = useUiStore((s) => s.active_tab)
    const agents           = useAgentStore((s) => s.agents)
    const selected_ids     = useAgentStore((s) => s.selected_agent_ids)
    const focused_agent_id = useAgentStore((s) => s.focused_agent_id)
    const setFocused       = useAgentStore((s) => s.setFocused)

    const online_agents   = agents.filter((a) => a.online)
    const selected_online = selected_ids.filter((id) => online_agents.some((a) => a.id === id))
    const mode            = deriveViewMode(active_tab, selected_online.length)

    // Which agent Focus should show: the single selection wins; otherwise keep
    // the current focus if it is still online, else fall back to the first agent.
    const focus_id = selected_online.length === 1
        ? selected_online[0]
        : (online_agents.some((a) => a.id === focused_agent_id) ? focused_agent_id : (online_agents[0]?.id ?? null))

    useEffect(function ()
    {
        if (mode === 'focus' && focus_id && focus_id !== focused_agent_id)
        {
            setFocused(focus_id)
        }
    }, [mode, focus_id, focused_agent_id, setFocused])

    const Grid = GRIDS[active_tab]
    const body = (mode === 'grid' && Grid) ? <Grid /> : <FocusView />

    return (
        <>
            <ModuleTabs />
            {body}
        </>
    )
}

export default MainArea
