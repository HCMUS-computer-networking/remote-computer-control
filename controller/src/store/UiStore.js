// UiStore.js — global UI state: theme, layout mode, active module tab, sidebar.
import { create } from 'zustand'

// Valid tab IDs — used by setActiveTab to reject unknown values.
const MODULE_TABS = ['sysinfo', 'application', 'process', 'screen', 'keylog', 'file', 'webcam', 'power']

let _toast_id = 0

const useUiStore = create(function (set)
{
    return {
        theme        : 'light',         // 'light' | 'dark'
        layout_mode  : 'grid',          // 'grid'  | 'focus' — legacy field; view is now derived from selection (services/viewMode)
        active_tab   : 'sysinfo',       // one of MODULE_TABS — SysInfo grid is the landing (read-only, no consent)
        sidebar_open : true,            // controls mobile sidebar visibility
        toasts       : [],              // array of { id, message, variant, timestamp }

        setTheme: (theme) =>
        {
            set({ theme });
        },

        toggleTheme: () =>
            set(function (s)
            {
                const next_theme = s.theme === 'light' ? 'dark' : 'light'
                return { theme: next_theme }
            }),

        setLayoutMode: (mode) =>
        {
            set({ layout_mode: mode });
        },

        // Switch the active module tab. Grid-vs-focus is derived from the current
        // selection (services/viewMode) — switching tabs no longer forces a mode.
        setActiveTab: (tab) =>
        {
            if (MODULE_TABS.includes(tab))
            {
                set({ active_tab: tab })
            }
        },

        toggleSidebar: () =>
            set(function (s)
            {
                return { sidebar_open: !s.sidebar_open }
            }),

        // Push a short-lived notification. Variant: 'success' | 'error' | 'info'.
        addToast: (message, variant = 'info') =>
        {
            const id = ++_toast_id
            set(function (s)
            {
                return { toasts: [...s.toasts, { id, message, variant, timestamp: Date.now() }] }
            })
            setTimeout(function ()
            {
                set(function (s)
                {
                    return { toasts: s.toasts.filter((t) => t.id !== id) }
                })
            }, 3000)
        },

        dismissToast: (id) =>
            set(function (s)
            {
                return { toasts: s.toasts.filter((t) => t.id !== id) }
            }),
    }
})

export { MODULE_TABS }
export default useUiStore
