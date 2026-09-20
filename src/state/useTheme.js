import { useEffect } from 'react'
import { useStore } from './store'

const DARK_QUERY = '(prefers-color-scheme: dark)'

/**
 * Applies the current theme to the document root as `data-theme`, which drives
 * the CSS variables in styles/theme.css, and — until the user picks a side —
 * keeps it in step with the OS light/dark setting, including changes made while
 * the editor is open. Call once near the app root.
 */
export function useThemeEffect() {
  const theme = useStore((s) => s.ui.theme)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia(DARK_QUERY)
    // Re-read on mount too: the OS may have changed while the tab was closed,
    // or since the store read it at startup.
    const sync = () => useStore.getState().systemThemeChanged(mq.matches ? 'dark' : 'light')
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])
}
