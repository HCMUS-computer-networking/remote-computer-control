/* ApplicationTab — start / stop whitelisted apps on the selected agent */
import { AppWindow } from 'lucide-react'

function ApplicationTab({ agent })
{
  return (
    <div className="module-placeholder">
      <AppWindow size={40} strokeWidth={1.25} className="module-placeholder__icon" />
      <span className="module-placeholder__label">
        Application — {agent.name}
      </span>
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        (whitelist table — coming soon)
      </span>
    </div>
  )
}

export default ApplicationTab
