import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import styles from './ContextMenu.module.css'

/**
 * A floating right-click menu anchored at a screen position. `items` is a list
 * of either `{ separator: true }` or
 * `{ label, icon?, shortcut?, disabled?, danger?, onClick }`.
 *
 * The menu clamps itself inside the viewport and closes on outside click,
 * Escape, scroll, resize, or after an item is chosen. Positioned `fixed`, so
 * `x`/`y` are client (screen) coordinates.
 */
export default function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null)
  const [pos, setPos] = useState({ x, y, ready: false })

  // Clamp into the viewport once we can measure the rendered menu.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const m = 6
    let nx = x
    let ny = y
    if (x + r.width + m > window.innerWidth) nx = Math.max(m, window.innerWidth - r.width - m)
    if (y + r.height + m > window.innerHeight) ny = Math.max(m, window.innerHeight - r.height - m)
    setPos({ x: nx, y: ny, ready: true })
  }, [x, y, items])

  useEffect(() => {
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', onClose)
    window.addEventListener('resize', onClose)
    window.addEventListener('wheel', onClose, { passive: true })
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', onClose)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('wheel', onClose)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className={`${styles.menu} no-select`}
      style={{ left: pos.x, top: pos.y, visibility: pos.ready ? 'visible' : 'hidden' }}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) =>
        item.separator ? (
          <div key={i} className={styles.sep} />
        ) : (
          <button
            key={i}
            type="button"
            role="menuitem"
            className={styles.item}
            data-danger={item.danger || undefined}
            disabled={item.disabled}
            onClick={() => {
              onClose()
              item.onClick && item.onClick()
            }}
          >
            {item.icon && <span className={styles.icon}>{item.icon}</span>}
            <span className={styles.label}>{item.label}</span>
            {item.shortcut && <span className={styles.shortcut}>{item.shortcut}</span>}
          </button>
        ),
      )}
    </div>
  )
}
