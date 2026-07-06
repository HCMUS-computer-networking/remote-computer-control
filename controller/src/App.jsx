// App.jsx — root shell: connects to the socket on mount, applies theme, renders layout.
import { useEffect }    from 'react'
import useUiStore       from './store/UiStore'
import useAgentSocket   from './hooks/UseAgentSocket'
import Sidebar          from './components/layout/Sidebar'
import TopBar           from './components/layout/TopBar'
import GridView         from './components/livescreen/GridView'
import FocusView        from './components/livescreen/FocusView'

function App()
{
    const theme        = useUiStore((s) => s.theme)
    const layout_mode  = useUiStore((s) => s.layout_mode)
    const toasts       = useUiStore((s) => s.toasts)
    const dismissToast = useUiStore((s) => s.dismissToast)

    // open the socket connection and start receiving data from MockSocket / Gateway
    useAgentSocket()

    // sync the data-theme attribute on <html> so all CSS variables flip correctly
    useEffect(function ()
    {
        if (theme === 'dark')
        {
            document.documentElement.setAttribute('data-theme', 'dark')
        }
        else
        {
            document.documentElement.removeAttribute('data-theme')
        }
    }, [theme])

    return (
        <div className="app-shell">
            <Sidebar />

            <div className="right-panel">
                <TopBar />

                <main className="main-area">
                    {layout_mode === 'grid' ? <GridView /> : <FocusView />}
                </main>
            </div>

            {/* ── Toast notifications ─────────────────────────── */}
            {toasts.length > 0 && (
                <div className="toast-container" aria-live="polite">
                    {toasts.map(function (t)
                    {
                        return (
                            <div
                                key={t.id}
                                className={`toast toast--${t.variant}`}
                                onClick={() => dismissToast(t.id)}
                                role="status"
                            >
                                {t.message}
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}

export default App
