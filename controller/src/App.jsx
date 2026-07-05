/* App.jsx — root component: applies theme, renders the two-column shell */
import { useEffect } from 'react'
import useUiStore from './store/UiStore'
import Sidebar    from './components/layout/Sidebar'
import TopBar     from './components/layout/TopBar'
import GridView   from './components/livescreen/GridView'
import FocusView  from './components/livescreen/FocusView'

function App()
{
  const { theme, view_mode } = useUiStore()

  /* sync the data-theme attribute on <html> so CSS variables flip correctly */
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
          {view_mode === 'grid' ? <GridView /> : <FocusView />}
        </main>
      </div>
    </div>
  )
}

export default App
