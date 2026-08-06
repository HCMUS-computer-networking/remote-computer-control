/* TopBar.jsx — header bar: breadcrumb title, session badge, connection, theme, admin */
import { Wifi, WifiOff, Loader2, LogOut } from 'lucide-react'
import { useShallow }      from 'zustand/react/shallow'
import useUiStore         from '../../store/UiStore'
import useAgentStore      from '../../store/AgentStore'
import useConnectionStore from '../../store/ConnectionStore'
import useModuleStore     from '../../store/ModuleStore'
import ThemeToggle        from './ThemeToggle'
import { logout }         from '../../services/AuthService'
import { deriveViewMode } from '../../services/viewMode'

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
  const active_tab       = useUiStore((s) => s.active_tab)
  const focused_agent_id = useAgentStore((s) => s.focused_agent_id)
  const agents           = useAgentStore((s) => s.agents)
  const selected_ids     = useAgentStore((s) => s.selected_agent_ids)
  const status           = useConnectionStore((s) => s.status)

  // Derive grid/focus the SAME way MainArea does, from the selection.
  const selected_online = selected_ids.filter((id) => agents.some((a) => a.id === id && a.online))
  const layout_mode     = deriveViewMode(active_tab, selected_online.length)

  // Global transparency badge — list agent ids that currently have any
  // sensitive module running. If non-empty we show a red "SENSITIVE" badge
  // so the operator ALWAYS knows something is being captured, regardless
  // of which view they are in.
  //
  // IMPORTANT: derive the id list INSIDE the selector and use useShallow
  // so this component only re-renders when the id set actually changes.
  // If we instead subscribed to s.data, every incoming frame (24fps in
  // focus mode) would re-render TopBar and cascade into modal children.
  const sensitive_flags = useModuleStore(useShallow(function (s)
  {
      const flags = {}
      for (const agent_id of Object.keys(s.data))
      {
          const d = s.data[agent_id]
          flags[agent_id] = !!(d?.screen_stream_active || d?.webcam_active || d?.keylog_active)
      }
      return flags
  }))
  const sensitive_agent_ids = agents
      .filter((a) => a.in_session || sensitive_flags[a.id])
      .map((a) => a.id)

  const focused_agent = agents.find((a) => a.id === focused_agent_id) ?? null

  /* build the breadcrumb title shown in the header */
  const tab_label = active_tab.charAt(0).toUpperCase() + active_tab.slice(1)
  let title = `${tab_label} — All Agents`
  if (layout_mode === 'focus' && focused_agent)
  {
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
        <span className="session-badge session-badge--topbar">● IN CONTROL</span>
      )}

      {/* Global transparency badge — any agent with a sensitive module active.
          Kept always-visible (across grid + focus) so nothing sensitive can
          run silently. Count makes multi-agent activity obvious. */}
      {sensitive_agent_ids.length > 0 && (
        <span
          className="session-badge session-badge--topbar"
          title={`Sensitive activity on: ${sensitive_agent_ids.join(', ')}`}
          style={{ background: 'var(--danger-solid)', color: 'var(--on-danger)' }}
        >
          ● SENSITIVE · {sensitive_agent_ids.length}
        </span>
      )}

      {/* View mode (grid vs focus) is driven by the sidebar selection:
          select exactly one agent → Focus; none or many → Grid. */}
      <ConnectionIndicator status={status} />

      <ThemeToggle />

      {/* Logout — clears the JWT; App then unmounts the console shell, which
          closes the socket (the ref-counted hook fires its cleanup). */}
      <button
        className="topbar__btn"
        onClick={logout}
        title="Logout"
        style={{ display: 'flex', alignItems: 'center', gap: 4 }}
      >
        <LogOut size={14} strokeWidth={1.75} />
        Logout
      </button>
    </header>
  )
}

export default TopBar
