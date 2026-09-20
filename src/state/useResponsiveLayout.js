import { useEffect, useRef } from 'react'
import { useStore } from './store'

// Below these viewport widths a side panel costs the canvas more than it's
// worth, so it collapses to a rail. The tools panel goes first (it's browsed
// occasionally); the properties panel only goes when things get really tight.
const LEFT_MIN_W = 1000
const RIGHT_MIN_W = 820

/**
 * Collapse the side panels to rails on viewports too narrow to carry them.
 *
 * Only *threshold crossings* act, and only an auto-collapse is ever auto-undone:
 * expanding a panel by hand on a narrow window sticks, and a panel the user
 * collapsed themselves is never re-opened for them.
 */
export function useResponsiveLayout() {
  const autoCollapsed = useRef({ left: false, right: false })
  const wasNarrow = useRef({ left: null, right: null })

  useEffect(() => {
    const step = (key, narrow, flag, setCollapsed) => {
      if (wasNarrow.current[key] === narrow) return // no crossing — leave it alone
      wasNarrow.current[key] = narrow
      const collapsed = useStore.getState().ui[flag]
      if (narrow) {
        if (!collapsed) {
          setCollapsed(true)
          autoCollapsed.current[key] = true
        }
      } else if (autoCollapsed.current[key]) {
        autoCollapsed.current[key] = false
        if (collapsed) setCollapsed(false)
      }
    }

    const sync = () => {
      const { setLeftCollapsed, setRightCollapsed } = useStore.getState()
      const w = window.innerWidth
      step('left', w < LEFT_MIN_W, 'leftCollapsed', setLeftCollapsed)
      step('right', w < RIGHT_MIN_W, 'rightCollapsed', setRightCollapsed)
    }

    sync()
    window.addEventListener('resize', sync)
    return () => window.removeEventListener('resize', sync)
  }, [])
}
