import styles from './CanvasView.module.css'

/**
 * The artboard. The page fill is artwork (white paper, or the document
 * background color) and never themed. The thin outline is editor chrome, drawn
 * with a non-scaling stroke so it stays 1px at any zoom.
 */
export default function PageFrame({ page, background }) {
  return (
    <g>
      <rect
        className={styles.page}
        x={0}
        y={0}
        width={page.width}
        height={page.height}
        fill={background || '#ffffff'}
      />
      <rect
        x={0}
        y={0}
        width={page.width}
        height={page.height}
        fill="none"
        vectorEffect="non-scaling-stroke"
        className={styles.pageBorder}
      />
    </g>
  )
}
