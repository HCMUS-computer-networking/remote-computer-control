// ModuleTabs.jsx — the 8-module tab bar, always visible above the main panel.
//
// Extracted out of FocusView so the SAME bar drives both single-agent Focus and
// the multi-agent Grids. Clicking a tab only sets active_tab; MainArea decides
// (from the selection) whether that tab renders as a Grid or a Focus panel.

import { AppWindow, Cpu, MonitorPlay, Keyboard, FolderTree, Video, Power, Activity } from 'lucide-react'
import useUiStore from '../store/UiStore'

// Order matches the wireframe left-to-right. Each id MUST match a MODULE_TABS
// value in UiStore (and a FEATURE constant for the gated ones).
const TABS =
[
    { id: 'sysinfo',     label: 'SysInfo',     Icon: Activity    },
    { id: 'application', label: 'Application', Icon: AppWindow   },
    { id: 'process',     label: 'Process',     Icon: Cpu         },
    { id: 'screen',      label: 'Screen',      Icon: MonitorPlay },
    { id: 'keylog',      label: 'Keylog',      Icon: Keyboard    },
    { id: 'file',        label: 'File',        Icon: FolderTree  },
    { id: 'webcam',      label: 'Webcam',      Icon: Video       },
    { id: 'power',       label: 'Power',       Icon: Power       },
]

function ModuleTabs()
{
    const active_tab   = useUiStore((s) => s.active_tab)
    const setActiveTab = useUiStore((s) => s.setActiveTab)

    return (
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
    )
}

export default ModuleTabs
