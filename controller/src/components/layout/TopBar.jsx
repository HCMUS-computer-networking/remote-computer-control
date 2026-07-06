/* TopBar.jsx — header bar: breadcrumb title, session badge, connection, theme, admin */
import { Wifi, WifiOff, Loader2, User, ChevronDown, LayoutGrid, Maximize2 } from 'lucide-react'
import useUiStore         from '../../store/UiStore'
import useAgentStore      from '../../store/AgentStore'
import useConnectionStore from '../../store/ConnectionStore'
import ThemeToggle        from './ThemeToggle'

/* map connection status to its icon + colour */
function ConnectionIndicator({ status })
{
  if (status === 'open')
  {
    return (
      <span className="topbar__connection">
        <Wifi size={14} strokeWidth={1.75} style={{ color: 'var(--success)' }} />
        Connected
      </span>
    )
  }
  if (status === 'connecting')
  {
    return (
      <span className="topbar__connection">
        <Loader2 size={14} strokeWidth={1.75} className="spin" style={{ color: 'var(--warning)' }} />
        Connecting…
      </span>
    )
  }
  // 'idle' or 'closed'
  return (
    <span className="topbar__connection">
      <WifiOff size={14} strokeWidth={1.75} style={{ color: 'var(--danger)' }} />
      Disconnected
    </span>
  )
}

function TopBar()
{
  const layout_mode      = useUiStore((s) => s.layout_mode)
  const active_tab       = useUiStore((s) => s.active_tab)
  const setLayoutMode    = useUiStore((s) => s.setLayoutMode)
  const focused_agent_id = useAgentStore((s) => s.focused_agent_id)
  const agents           = useAgentStore((s) => s.agents)
  const status           = useConnectionStore((s) => s.status)

  const focused_agent = agents.find((a) => a.id === focused_agent_id) ?? null

  /* build the breadcrumb title shown in the header */
  let title = 'Grid View — All Agents'
  if (layout_mode === 'focus' && focused_agent)
  {
    const tab_label = active_tab.charAt(0).toUpperCase() + active_tab.slice(1)
    title = `${focused_agent.name}  ›  ${tab_label}`
  }
  else if (layout_mode === 'focus')
  {
    title = 'Focus Mode — Select an Agent'
  }

  const in_session = focused_agent?.in_session && layout_mode === 'focus'

  return (
    <header className="topbar">
      {/* breadcrumb / page title */}
      <span className="topbar__title">{title}</span>

      {/* "ĐANG ĐIỀU KHIỂN" badge — only visible while a session is active */}
      {in_session && (
        <span className="session-badge session-badge--topbar">● ĐANG ĐIỀU KHIỂN</span>
      )}

      {/* view-mode toggle buttons */}
      <button
        className="topbar__btn"
        onClick={() => setLayoutMode('grid')}
        title="Grid view — all agents"
        aria-pressed={layout_mode === 'grid'}
      >
        <LayoutGrid size={14} strokeWidth={1.75} />
      </button>

      <button
        className="topbar__btn"
        onClick={() => setLayoutMode('focus')}
        title="Focus view — single agent"
        aria-pressed={layout_mode === 'focus'}
      >
        <Maximize2 size={14} strokeWidth={1.75} />
      </button>

      <ConnectionIndicator status={status} />

      <ThemeToggle />

      {/* admin dropdown placeholder */}
      <button className="topbar__btn" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <User size={14} strokeWidth={1.75} />
        Admin
        <ChevronDown size={12} strokeWidth={1.75} />
      </button>
    </header>
  )
}

export default TopBar
