/* ThemeToggle.jsx — sun/moon button that toggles light ↔ dark theme */
import { Sun, Moon } from 'lucide-react'
import useUiStore from '../../store/UiStore'

function ThemeToggle()
{
  const theme       = useUiStore((s) => s.theme)
  const toggleTheme = useUiStore((s) => s.toggleTheme)
  const is_dark = theme === 'dark'

  return (
    <button
      className="topbar__btn"
      onClick={toggleTheme}
      title={is_dark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label={is_dark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {is_dark
        ? <Sun  size={14} strokeWidth={1.75} />
        : <Moon size={14} strokeWidth={1.75} />}
    </button>
  )
}

export default ThemeToggle
