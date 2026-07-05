/* FocusView.jsx — single-agent view: 7-tab bar + active module panel */
import { AppWindow, Cpu, MonitorPlay, Keyboard, FolderTree, Video, Power } from 'lucide-react'
import useUiStore    from '../../store/UiStore'
import useAgentStore from '../../store/AgentStore'

import ApplicationTab from '../modules/ApplicationTab'
import ProcessTab     from '../modules/ProcessTab'
import ScreenTab      from '../modules/ScreenTab'
import KeylogTab      from '../modules/KeylogTab'
import FileTab        from '../modules/FileTab'
import WebcamTab      from '../modules/WebcamTab'
import PowerTab       from '../modules/PowerTab'

/* tab definitions — order matches wireframe left-to-right */
const TABS = [
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
  application: ApplicationTab,
  process:     ProcessTab,
  screen:      ScreenTab,
  keylog:      KeylogTab,
  file:        FileTab,
  webcam:      WebcamTab,
  power:       PowerTab,
}

function FocusView()
{
  const { active_tab, setActiveTab } = useUiStore()
  const { getSelectedAgent }         = useAgentStore()

  const selected_agent = getSelectedAgent()

  /* no agent selected yet — prompt the user */
  if (!selected_agent)
  {
    return (
      <div className="focus-view">
        <div className="focus-view__no-agent">
          <span>Select an agent from the sidebar to start.</span>
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

      {/* active module panel */}
      <div className="focus-view__panel" role="tabpanel">
        <ActivePanel agent={selected_agent} />
      </div>
    </div>
  )
}

export default FocusView
