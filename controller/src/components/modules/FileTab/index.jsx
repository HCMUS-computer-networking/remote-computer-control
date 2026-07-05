/* FileTab — browse, upload, and download files inside the agent's sandbox */
import { FolderTree } from 'lucide-react'

function FileTab({ agent })
{
  return (
    <div className="module-placeholder">
      <FolderTree size={40} strokeWidth={1.25} className="module-placeholder__icon" />
      <span className="module-placeholder__label">
        File — {agent.name}
      </span>
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        (sandbox file tree + upload / download — coming soon)
      </span>
    </div>
  )
}

export default FileTab
