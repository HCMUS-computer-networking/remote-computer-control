/* KeylogTab — terminal-style view of captured keystrokes (consent required) */
import { Keyboard } from 'lucide-react'

function KeylogTab({ agent })
{
  return (
    <div className="module-placeholder">
      <Keyboard size={40} strokeWidth={1.25} className="module-placeholder__icon" />
      <span className="module-placeholder__label">
        Keylog — {agent.name}
      </span>
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        (terminal log with visible-indicator consent — coming soon)
      </span>
    </div>
  )
}

export default KeylogTab
