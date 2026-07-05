/* PowerTab — lock, restart, shutdown, and sleep actions for the selected agent */
import { Power } from 'lucide-react'

function PowerTab({ agent })
{
  return (
    <div className="module-placeholder">
      <Power size={40} strokeWidth={1.25} className="module-placeholder__icon" />
      <span className="module-placeholder__label">
        Power — {agent.name}
      </span>
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        (lock / restart / shutdown / sleep with countdown confirm — coming soon)
      </span>
    </div>
  )
}

export default PowerTab
