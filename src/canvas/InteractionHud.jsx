import { useStore } from '../state/store'
import { selectionBBox } from '../model/bbox'
import { worldToScreen } from './viewport'
import styles from './CanvasView.module.css'

// Round to at most one decimal, dropping a trailing .0.
const fmt = (n) => {
  const r = Math.round(n * 10) / 10
  return Number.isInteger(r) ? String(r) : r.toFixed(1)
}

/**
 * Small floating readout shown while dragging: the selection's position (X / Y)
 * during a move, or its size (W × H) while resizing. Positioned in screen space
 * relative to the current selection box.
 */
export default function InteractionHud() {
  const hud = useStore((s) => s.ui.hud)
  const vp = useStore((s) => s.viewport)
  const doc = useStore((s) => s.document)
  const selection = useStore((s) => s.selection)
  if (!hud) return null
  const box = selectionBBox(doc, selection)
  if (!box) return null

  let label
  let left
  let top
  let centered = false
  if (hud.kind === 'move') {
    label = `X ${fmt(hud.x)}   Y ${fmt(hud.y)}`
    const p = worldToScreen(box.x, box.y, vp)
    left = p.x
    top = p.y - 26
  } else {
    label = `${fmt(hud.width)} × ${fmt(hud.height)}`
    const p = worldToScreen(box.x + box.width / 2, box.y + box.height, vp)
    left = p.x
    top = p.y + 10
    centered = true
  }

  return (
    <div
      className={styles.hud}
      style={{ left, top, transform: centered ? 'translateX(-50%)' : undefined }}
    >
      {label}
    </div>
  )
}
