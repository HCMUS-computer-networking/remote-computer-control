/* ScreenTab — screenshot and live stream view for the selected agent */
import { MonitorPlay } from 'lucide-react'

function ScreenTab({ agent })
{
  return (
    <div className="module-placeholder">
      <MonitorPlay size={40} strokeWidth={1.25} className="module-placeholder__icon" />
      <span className="module-placeholder__label">
        Screen — {agent.name}
      </span>
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        (screenshot + 24 fps live stream — coming soon)
      </span>
    </div>
  )
}

export default ScreenTab
