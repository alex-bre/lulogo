import { useEffect } from 'react'
import { useStore } from '../state/store'
import { input } from './inputState'

/**
 * Wheel + drag controls for the infinite canvas, attached as native listeners
 * (wheel must be non-passive to preventDefault). Store actions are read via
 * getState() so the effect never needs to re-subscribe.
 *
 *  - ctrl/cmd + wheel (or trackpad pinch) → zoom to cursor
 *  - plain wheel / two-finger scroll       → pan
 *  - middle-drag, or Space + left-drag      → pan
 */
export function useViewportControls(svgRef) {
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return

    let panning = false
    let lastX = 0
    let lastY = 0

    const onWheel = (e) => {
      e.preventDefault()
      const rect = svg.getBoundingClientRect()
      if (e.ctrlKey || e.metaKey) {
        const cx = e.clientX - rect.left
        const cy = e.clientY - rect.top
        const factor = Math.exp(-e.deltaY * 0.0015)
        useStore.getState().zoomAt(cx, cy, factor)
      } else {
        useStore.getState().panBy(-e.deltaX, -e.deltaY)
      }
    }

    const onPointerDown = (e) => {
      if (e.button === 1 || (e.button === 0 && input.space)) {
        panning = true
        lastX = e.clientX
        lastY = e.clientY
        e.preventDefault()
        svg.style.cursor = 'grabbing'
      }
    }

    const onPointerMove = (e) => {
      if (!panning) return
      const dx = e.clientX - lastX
      const dy = e.clientY - lastY
      lastX = e.clientX
      lastY = e.clientY
      useStore.getState().panBy(dx, dy)
    }

    const onPointerUp = () => {
      if (!panning) return
      panning = false
      svg.style.cursor = input.space ? 'grab' : ''
    }

    // Cursor affordance while Space is held.
    const onKeyDown = (e) => {
      if (e.code === 'Space' && !panning) svg.style.cursor = 'grab'
    }
    const onKeyUp = (e) => {
      if (e.code === 'Space' && !panning) svg.style.cursor = ''
    }

    svg.addEventListener('wheel', onWheel, { passive: false })
    svg.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    return () => {
      svg.removeEventListener('wheel', onWheel)
      svg.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [svgRef])
}
