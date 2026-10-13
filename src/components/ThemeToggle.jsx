import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { applyTheme, useStore } from '../store'
import { Icon } from './ui'

const isDark = () => document.documentElement.classList.contains('dark')

/** One-tap light/dark switch. Saved to your account when logged in, and remembered on this device either way. */
export default function ThemeToggle({ className = '' }) {
  const [dark, setDark] = useState(isDark)
  useEffect(() => {
    const obs = new MutationObserver(() => setDark(isDark()))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])

  async function toggle() {
    const theme = dark ? 'light' : 'dark'
    applyTheme(theme)
    const { me, setMe } = useStore.getState()
    if (me) {
      try { setMe({ ...me, settings: await api.patch('/settings', { theme }) }) } catch { /* the local switch already happened */ }
    }
  }

  return (
    <button type="button" className={`icon-btn ${className}`} onClick={toggle} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} title={dark ? 'Light mode' : 'Dark mode'}>
      <Icon name={dark ? 'sun' : 'moon'} />
    </button>
  )
}
