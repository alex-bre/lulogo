import styles from './CanvasView.module.css'

/** Box-select rectangle, world space, non-interactive. */
export default function Marquee({ rect }) {
  if (!rect) return null
  return (
    <rect
      className={styles.marquee}
      x={rect.x}
      y={rect.y}
      width={rect.width}
      height={rect.height}
      vectorEffect="non-scaling-stroke"
      pointerEvents="none"
    />
  )
}
