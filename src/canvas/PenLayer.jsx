import { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { screenToWorld } from './viewport'
import { snapValue } from '../model/snap'
import { anchorsToPath } from '../model/pen'
import styles from './CanvasView.module.css'

/**
 * Pen tool: click to drop anchors, drag to pull out smooth bezier handles.
 * Click the first anchor (or double-click / Enter) to finish; Escape cancels.
 * Rendered (and its listeners attached) only while the pen tool is active.
 */
export default function PenLayer({ svgRef }) {
  const zoom = useStore((s) => s.viewport.zoom)
  const [anchors, setAnchors] = useState([])
  const [cursor, setCursor] = useState(null)
  const anchorsRef = useRef(anchors)
  const draggingRef = useRef(-1)
  anchorsRef.current = anchors

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return

    const toWorld = (e) => {
      const rect = svg.getBoundingClientRect()
      const vp = useStore.getState().viewport
      const w = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, vp)
      const d = useStore.getState().document
      return { x: snapValue(w.x, d.snapping, d.grid), y: snapValue(w.y, d.snapping, d.grid) }
    }

    const reset = () => {
      anchorsRef.current = []
      draggingRef.current = -1
      setAnchors([])
      setCursor(null)
    }
    const finish = (closed) => {
      const a = anchorsRef.current
      if (a.length >= 2) useStore.getState().addPath(anchorsToPath(a, closed), closed)
      reset()
      useStore.getState().setTool('select')
    }

    const onDown = (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      const p = toWorld(e)
      const a = anchorsRef.current
      // Close when clicking near the first anchor.
      if (a.length >= 2) {
        const f = a[0]
        if (Math.hypot(f.x - p.x, f.y - p.y) <= 8 / useStore.getState().viewport.zoom) {
          finish(true)
          return
        }
      }
      const next = [...a, { x: p.x, y: p.y, hIn: null, hOut: null }]
      anchorsRef.current = next
      setAnchors(next)
      draggingRef.current = next.length - 1
    }

    const onMove = (e) => {
      const p = toWorld(e)
      setCursor(p)
      const i = draggingRef.current
      if (i < 0) return
      const next = anchorsRef.current.map((an, idx) =>
        idx === i ? { ...an, hOut: { x: p.x, y: p.y }, hIn: { x: 2 * an.x - p.x, y: 2 * an.y - p.y } } : an,
      )
      anchorsRef.current = next
      setAnchors(next)
    }

    const onUp = () => {
      draggingRef.current = -1
    }
    const onDbl = (e) => {
      e.preventDefault()
      finish(false)
    }
    const onKey = (e) => {
      if (e.key === 'Enter') finish(false)
      else if (e.key === 'Escape') {
        reset()
        useStore.getState().setTool('select')
      }
    }

    svg.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    svg.addEventListener('dblclick', onDbl)
    window.addEventListener('keydown', onKey)
    return () => {
      svg.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      svg.removeEventListener('dblclick', onDbl)
      window.removeEventListener('keydown', onKey)
    }
  }, [svgRef])

  const r = 4 / zoom
  const committed = anchorsToPath(anchors, false)
  const last = anchors[anchors.length - 1]
  const rubber = last && cursor ? `M ${last.x} ${last.y} L ${cursor.x} ${cursor.y}` : ''

  return (
    <g pointerEvents="none">
      {committed && (
        <path d={committed} className={styles.penPath} fill="none" vectorEffect="non-scaling-stroke" />
      )}
      {rubber && <path d={rubber} className={styles.penRubber} fill="none" vectorEffect="non-scaling-stroke" />}
      {anchors.map((a, i) => (
        <g key={i}>
          {a.hOut && (
            <>
              <line x1={a.x} y1={a.y} x2={a.hOut.x} y2={a.hOut.y} className={styles.penHandleLine} vectorEffect="non-scaling-stroke" />
              <circle cx={a.hOut.x} cy={a.hOut.y} r={r * 0.8} className={styles.penHandle} vectorEffect="non-scaling-stroke" />
            </>
          )}
          {a.hIn && (
            <>
              <line x1={a.x} y1={a.y} x2={a.hIn.x} y2={a.hIn.y} className={styles.penHandleLine} vectorEffect="non-scaling-stroke" />
              <circle cx={a.hIn.x} cy={a.hIn.y} r={r * 0.8} className={styles.penHandle} vectorEffect="non-scaling-stroke" />
            </>
          )}
          <circle cx={a.x} cy={a.y} r={r} className={i === 0 ? styles.penAnchorFirst : styles.penAnchor} vectorEffect="non-scaling-stroke" />
        </g>
      ))}
    </g>
  )
}
