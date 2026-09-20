import styles from './CanvasView.module.css'

/**
 * Blue alignment guides (world space, non-interactive). Each guide is a line
 * where a dragged object's edge/center lines up with another object's edge or
 * center; strokes stay 1px on screen at any zoom.
 */
export default function SnapGuides({ guides }) {
  if (!guides || !guides.length) return null
  return (
    <g pointerEvents="none">
      {guides.map((g, i) => {
        const coords =
          g.o === 'v'
            ? { x1: g.pos, y1: g.min, x2: g.pos, y2: g.max }
            : { x1: g.min, y1: g.pos, x2: g.max, y2: g.pos }
        return <line key={i} className={styles.snapGuide} {...coords} vectorEffect="non-scaling-stroke" />
      })}
    </g>
  )
}
