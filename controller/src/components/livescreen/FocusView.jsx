/* FocusView.jsx — single-agent view: 7-tab bar + active module panel */
import { AppWindow, Cpu, MonitorPlay, Keyboard, FolderTree, Video, Power, MousePointerClick, Activity, Loader2 } from 'lucide-react'
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

/* tab definitions — order matches wireframe left-to-right.
   NOTE: each tab id MUST match a FEATURE constant in Protocol.js (used verbatim
   as the `feature` field of permission_request / revoke / stop). The only
   exception is any id listed in NO_PERMISSION_TABS, which renders directly
   without a PermissionGate wrapper. */
const TABS =
[
  { id: 'sysinfo',     label: 'SysInfo',     Icon: Activity   },
  { id: 'application', label: 'Application', Icon: AppWindow  },
  { id: 'process',     label: 'Process',     Icon: Cpu        },
  { id: 'screen',      label: 'Screen',      Icon: MonitorPlay },
  { id: 'keylog',      label: 'Keylog',      Icon: Keyboard   },
  { id: 'file',        label: 'File',        Icon: FolderTree },
  { id: 'webcam',      label: 'Webcam',      Icon: Video      },
  { id: 'power',       label: 'Power',       Icon: Power      },
]

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
  const setActiveTab      = useUiStore((s) => s.setActiveTab)
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
      {/* 7-tab navigation bar */}
      <nav className="focus-view__tabs" role="tablist" aria-label="Module tabs">
        {TABS.map(function ({ id, label, Icon })
        {
          const is_active = active_tab === id
          return (
            <button
              key={id}
              role="tab"
              aria-selected={is_active}
              className={`focus-view__tab${is_active ? ' focus-view__tab--active' : ''}`}
              onClick={() => setActiveTab(id)}
            >
              <Icon size={16} strokeWidth={1.75} />
              {label}
            </button>
          )
        })}
      </nav>

      {/* active module panel — sysinfo skips PermissionGate (read-only metrics) */}
      <div className="focus-view__panel" role="tabpanel">
        {e2eeState !== 'ready' ? (
           <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', background: 'var(--bg-card)' }}>
               <Loader2 size={32} className="spin" style={{ marginBottom: '1rem', color: 'var(--brand)' }} />
               <h3 style={{ margin: '0 0 0.5rem 0' }}>Đang thiết lập E2EE...</h3>
               <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem', margin: 0 }}>Trao đổi khóa công khai và xác thực.</p>
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
