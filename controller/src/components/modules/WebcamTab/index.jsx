/* WebcamTab — live webcam feed from the selected agent (consent required) */
import { Video } from 'lucide-react'

function WebcamTab({ agent })
{
  return (
    <div className="module-placeholder">
      <Video size={40} strokeWidth={1.25} className="module-placeholder__icon" />
      <span className="module-placeholder__label">
        Webcam — {agent.name}
      </span>
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        (live feed with visible consent indicator — coming soon)
      </span>
    </div>
  )
}

export default WebcamTab
