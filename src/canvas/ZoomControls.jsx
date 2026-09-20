import { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { computeFit, clampZoom } from './viewport'
import styles from './CanvasView.module.css'

export default function ZoomControls({ size }) {
  const zoom = useStore((s) => s.viewport.zoom)
  const zoomAt = useStore((s) => s.zoomAt)
  const setViewport = useStore((s) => s.setViewport)
  const page = useStore((s) => s.document.page)

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef(null)

  const center = () => ({ x: (size.width || 0) / 2, y: (size.height || 0) / 2 })

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const startEditing = () => {
    setDraft(String(Math.round(zoom * 100)))
    setEditing(true)
  }

  const commit = () => {
    const pct = parseFloat(draft)
    if (Number.isFinite(pct) && pct > 0) {
      const target = clampZoom(pct / 100)
      const c = center()
      zoomAt(c.x, c.y, target / zoom)
    }
    setEditing(false)
  }

  return (
    <div className={`${styles.zoomBar} no-select`}>
      <button
        className={styles.zoomBtn}
        onClick={() => {
          const c = center()
          zoomAt(c.x, c.y, 1 / 1.2)
        }}
        title="Zoom out"
      >
        −
      </button>
      {editing ? (
        <input
          ref={inputRef}
          className={styles.zoomInput}
          type="text"
          inputMode="decimal"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            else if (e.key === 'Escape') setEditing(false)
          }}
          aria-label="Zoom percentage"
        />
      ) : (
        <button
          className={styles.zoomLabel}
          onClick={startEditing}
          title="Set zoom (%)"
        >
          {Math.round(zoom * 100)}%
        </button>
      )}
      <button
        className={styles.zoomBtn}
        onClick={() => {
          const c = center()
          zoomAt(c.x, c.y, 1.2)
        }}
        title="Zoom in"
      >
        +
      </button>
      <button
        className={styles.fitBtn}
        onClick={() => setViewport(computeFit(size.width, size.height, page.width, page.height))}
        title="Fit page to view"
      >
        Fit
      </button>
    </div>
  )
}
