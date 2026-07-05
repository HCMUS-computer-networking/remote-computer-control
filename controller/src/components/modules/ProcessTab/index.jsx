/* ProcessTab — view and kill running processes on the selected agent */
import { Cpu } from 'lucide-react'

function ProcessTab({ agent })
{
  return (
    <div className="module-placeholder">
      <Cpu size={40} strokeWidth={1.25} className="module-placeholder__icon" />
      <span className="module-placeholder__label">
        Process — {agent.name}
      </span>
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        (process table + kill action — coming soon)
      </span>
    </div>
  )
}

export default ProcessTab
