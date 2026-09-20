import { useStore } from '../state/store'
import { nodeTransform } from '../model/transform'
import { parsePath, cubicPoint } from '../model/pathEdit'
import styles from './CanvasView.module.css'

/**
 * Overlay for point-level path editing (world space, non-scaling strokes).
 * Renders, in the edited path's own transform frame:
 *  - a wide transparent hit-path over each segment (click-drag inserts a point),
 *    with a faint dot at its midpoint as an affordance,
 *  - bezier handles (draggable) with connector lines,
 *  - square anchor points (drag to move, Alt-click or Delete to remove).
 * All pointer handling lives in useCanvasInteractions, keyed off data-pathpt.
 */
export default function PathEditLayer() {
  const id = useStore((s) => s.ui.editingPathId)
  const node = useStore((s) => (id ? s.document.nodes[id] : null))
  const zoom = useStore((s) => s.viewport.zoom)
  const active = useStore((s) => s.ui.activeAnchor)
  if (!node || node.type !== 'path') return null

  const subs = parsePath(node.d)
  const r = 4 / zoom
  const hw = 12 / zoom // segment hit width

  const segs = []
  const handles = []
  const points = []

  subs.forEach((sp, si) => {
    const A = sp.anchors
    const count = sp.closed ? A.length : A.length - 1
    for (let ai = 0; ai < count; ai++) {
      const p0 = A[ai]
      const p1 = A[(ai + 1) % A.length]
      const cubic = p0.hOut || p1.hIn
      const c1 = p0.hOut || p0
      const c2 = p1.hIn || p1
      const d = cubic
        ? `M ${p0.x} ${p0.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${p1.x} ${p1.y}`
        : `M ${p0.x} ${p0.y} L ${p1.x} ${p1.y}`
      const mid = cubic ? cubicPoint(p0, c1, c2, p1, 0.5) : { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 }
      segs.push(
        <g key={`s${si}-${ai}`}>
          <path
            d={d}
            data-pathpt="segment"
            data-sp={si}
            data-ai={ai}
            fill="none"
            stroke="transparent"
            strokeWidth={hw}
            style={{ cursor: 'copy' }}
          />
          <circle className={styles.penAddDot} cx={mid.x} cy={mid.y} r={r * 0.6} vectorEffect="non-scaling-stroke" pointerEvents="none" />
        </g>,
      )
    }

    A.forEach((a, ai) => {
      for (const h of ['out', 'in']) {
        const p = h === 'out' ? a.hOut : a.hIn
        if (!p) continue
        handles.push(
          <g key={`h${h}${si}-${ai}`}>
            <line x1={a.x} y1={a.y} x2={p.x} y2={p.y} className={styles.penHandleLine} vectorEffect="non-scaling-stroke" pointerEvents="none" />
            <circle
              cx={p.x}
              cy={p.y}
              r={r * 0.8}
              className={styles.penHandle}
              data-pathpt="handle"
              data-sp={si}
              data-ai={ai}
              data-h={h}
              vectorEffect="non-scaling-stroke"
              style={{ cursor: 'move' }}
            />
          </g>,
        )
      }
      const isActive = active && active.sp === si && active.ai === ai
      points.push(
        <rect
          key={`a${si}-${ai}`}
          data-pathpt="anchor"
          data-sp={si}
          data-ai={ai}
          x={a.x - r}
          y={a.y - r}
          width={r * 2}
          height={r * 2}
          className={isActive ? styles.penAnchorActive : styles.penAnchor}
          vectorEffect="non-scaling-stroke"
          style={{ cursor: 'move' }}
        />,
      )
    })
  })

  return (
    <g transform={nodeTransform(node)}>
      {segs}
      {handles}
      {points}
    </g>
  )
}
