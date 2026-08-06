/* FocusView.jsx — single-agent view: renders the active module panel for the
   focused agent. The tab bar now lives in ModuleTabs (shared with the grids). */
import { MousePointerClick, Loader2 } from 'lucide-react'
import useUiStore    from '../../store/UiStore'
import useAgentStore from '../../store/AgentStore'
import useE2EEStore  from '../../store/E2EEStore'

import SysInfoTab     from '../modules/SysInfoTab'
import ApplicationTab from '../modules/ApplicationTab'
import ProcessTab     from '../modules/ProcessTab'
import ScreenTab      from '../modules/ScreenTab'
import KeylogTab      from '../modules/KeylogTab'
import FileTab        from '../modules/FileTab'
import WebcamTab      from '../modules/WebcamTab'
import PowerTab       from '../modules/PowerTab'
import PermissionGate from '../PermissionGate'

// Tabs that read only non-sensitive metrics and therefore skip the consent
// handshake entirely — no permission_request is ever sent for them.
const NO_PERMISSION_TABS = new Set(['sysinfo'])

/* map tab id → module component */
const TAB_PANELS =
{
  sysinfo     : SysInfoTab,
  application : ApplicationTab,
  process     : ProcessTab,
  screen      : ScreenTab,
  keylog      : KeylogTab,
  file        : FileTab,
  webcam      : WebcamTab,
  power       : PowerTab,
}

function FocusView()
{
  const active_tab        = useUiStore((s) => s.active_tab)
  const focused_agent_id  = useAgentStore((s) => s.focused_agent_id)
  const agents            = useAgentStore((s) => s.agents)
  const e2eeState         = useE2EEStore((s) => s.sessions[focused_agent_id]?.state || 'uninitialized')

  const focused_agent = agents.find((a) => a.id === focused_agent_id) ?? null

  /* no agent focused yet — prompt the user */
  if (!focused_agent)
  {
    return (
      <div className="focus-view">
        <div className="focus-view__no-agent">
          <MousePointerClick size={40} strokeWidth={1.25} />
          <span>No agent selected — pick a machine from the sidebar to start.</span>
        </div>
      </div>
    )
  }

  const ActivePanel = TAB_PANELS[active_tab] ?? ApplicationTab

  return (
    <div className="focus-view">
      {/* active module panel — sysinfo skips PermissionGate (read-only metrics) */}
      <div className="focus-view__panel" role="tabpanel">
        {e2eeState === 'handshaking' ? (
           <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', background: 'var(--bg-card)' }}>
               <Loader2 size={32} className="spin" style={{ marginBottom: '1rem', color: 'var(--brand)' }} />
               <h3 style={{ margin: '0 0 0.5rem 0' }}>Establishing E2EE…</h3>
               <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem', margin: 0 }}>Exchanging public keys and authenticating.</p>
           </div>
        ) : e2eeState === 'uninitialized' ? (
           <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', background: 'var(--bg-card)' }}>
               <h3 style={{ margin: '0 0 0.5rem 0', color: 'var(--text-error)' }}>E2EE Handshake Failed</h3>
               <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem', margin: '0 0 1rem 0' }}>Could not establish an encrypted connection. Wrong PIN or the Agent declined.</p>
               <button 
                   className="btn btn-primary" 
                   onClick={() => window.location.reload()}
               >
                   Reload page (Retry)
               </button>
           </div>
        ) : NO_PERMISSION_TABS.has(active_tab) ? (
          <ActivePanel key={focused_agent.id} agent={focused_agent} />
        ) : (
          <PermissionGate feature={active_tab} agent_id={focused_agent.id}>
            <ActivePanel key={focused_agent.id} agent={focused_agent} />
          </PermissionGate>
        )}
      </div>
    </div>
  )
}

export default FocusView
