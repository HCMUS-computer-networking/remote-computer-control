// viewMode.js — single source of truth for "grid vs focus" routing.
//
// Rule agreed with the user:
//   - Grid-capable modules show a multi-agent GRID unless EXACTLY ONE agent is
//     selected (online), in which case they drop into single-agent FOCUS.
//   - Every other module (file / application / process) is always FOCUS.
// Shared by MainArea (what to render) and TopBar (breadcrumb title) so the two
// never disagree.

export const GRID_MODULES = new Set(['sysinfo', 'keylog', 'webcam', 'power', 'screen'])

// active_tab                — current module tab id
// selected_online_count     — number of SELECTED agents that are online
export function deriveViewMode(active_tab, selected_online_count)
{
    if (!GRID_MODULES.has(active_tab)) return 'focus'
    return selected_online_count === 1 ? 'focus' : 'grid'
}
