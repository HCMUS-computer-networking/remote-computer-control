// App.jsx — root gate: shows LoginScreen until a JWT is present, then mounts the
// console shell (which owns the socket) so no data flows before authentication.
import { useEffect }      from 'react'
import { WifiOff, Loader2 } from 'lucide-react'
import useUiStore         from './store/UiStore'
import useConnectionStore from './store/ConnectionStore'
import useAgentSocket     from './hooks/UseAgentSocket'
import LoginScreen        from './components/LoginScreen'
import Sidebar            from './components/layout/Sidebar'
import TopBar             from './components/layout/TopBar'
import GridView           from './components/livescreen/GridView'
import FocusView          from './components/livescreen/FocusView'
import E2EEUnlockModal    from './components/E2EEUnlockModal'

// Full-width strip shown while the socket is not open. Warns the operator that
// data may be stale and that a reconnect is in progress. Hidden when connected.
function ConnectionBanner({ status })
{
    if (status === 'connecting')
    {
        return (
            <div className="conn-banner conn-banner--warning" role="status">
                <Loader2 size={14} strokeWidth={2} className="spin" />
                Connecting to Gateway…
            </div>
        )
    }
    if (status === 'closed')
    {
        return (
            <div className="conn-banner conn-banner--danger" role="alert">
                <WifiOff size={14} strokeWidth={2} />
                Gateway disconnected — retrying…
            </div>
        )
    }
    return null   // 'open' or 'idle' — no banner
}

// Authenticated console shell — owns the socket (via useAgentSocket) so the
// connection only opens AFTER login and closes automatically on logout when this
// component unmounts (the hook is ref-counted: last unmount → socket.close()).
function ConsoleShell()
{
    const layout_mode  = useUiStore((s) => s.layout_mode)
    const conn_status  = useConnectionStore((s) => s.status)

    // open the socket connection and start receiving data from MockSocket / Gateway
    useAgentSocket()

    return (
        <div className="app-shell">
            <Sidebar />

            <div className="right-panel">
                <ConnectionBanner status={conn_status} />
                <TopBar />

                <main className="main-area">
                    {layout_mode === 'grid' ? <GridView /> : <FocusView />}
                </main>
            </div>
        </div>
    )
}

function App()
{
    const theme        = useUiStore((s) => s.theme)
    const toasts       = useUiStore((s) => s.toasts)
    const dismissToast = useUiStore((s) => s.dismissToast)
    const auth_token   = useConnectionStore((s) => s.auth_token)

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
        <>
            <E2EEUnlockModal />
            {/* Gate: no JWT → login form; with JWT → console (socket owner). */}
            {auth_token ? <ConsoleShell /> : <LoginScreen />}

            {/* ── Toast notifications (shown in both login + console) ────── */}
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
        </>
    )
}

export default App
