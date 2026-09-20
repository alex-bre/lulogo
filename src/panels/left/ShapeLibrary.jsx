import { SHAPE_KINDS } from '../../model/shapes'
import { useStore } from '../../state/store'
import ShapePreview from './ShapePreview'
import styles from './ShapeLibrary.module.css'

/**
 * Palette of library shapes. Each preview is the real shape geometry (from
 * createShapeOfKind), so adding a new shape there is all that's needed — no icon
 * to wire up. Click places a shape at the view center; drag & drop places it at
 * the cursor (handled by CanvasView's drop target).
 */
export default function ShapeLibrary() {
  const addAtViewCenter = useStore((s) => s.addShapeAtViewCenter)

  return (
    <div className={styles.grid}>
      {SHAPE_KINDS.map(({ kind, label }) => (
        <button
          key={kind}
          className={styles.item}
          title={label}
          draggable
          onClick={() => addAtViewCenter(kind)}
          onDragStart={(e) => {
            e.dataTransfer.setData('application/x-ic-shape', kind)
            e.dataTransfer.effectAllowed = 'copy'
          }}
        >
          <ShapePreview kind={kind} />
        </button>
      ))}
    </div>
  )
}
