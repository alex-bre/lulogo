import { useState } from 'react'
import {
  PenTool,
  Spline,
  SquaresUnite,
  SquaresSubtract,
  SquaresIntersect,
  SquaresExclude,
  Hexagon,
  CornerUpLeft,
} from 'lucide-react'
import { useStore } from '../../state/store'
import { performBoolean } from '../../geometry/boolean'
import { performConvexHull } from '../../geometry/convexHull'
import { isBooleanable } from '../../geometry/paperBridge'
import { selectionLeaves } from '../../state/selectors'
import { canRoundCorners } from '../../model/roundCorners'
import { NumberInput } from '../common/Controls'
import { outlineTextNodes } from '../../io/textToPath'
import { beginHistoryBatch, endHistoryBatch } from '../../state/history'
import styles from './PathTools.module.css'

const OPS = [
  { op: 'union', label: 'Union', Icon: SquaresUnite },
  { op: 'subtract', label: 'Subtract', Icon: SquaresSubtract },
  { op: 'intersect', label: 'Intersect', Icon: SquaresIntersect },
  { op: 'exclude', label: 'Exclude', Icon: SquaresExclude },
]

export default function PathTools() {
  const tool = useStore((s) => s.ui.tool)
  const setTool = useStore((s) => s.setTool)
  const selection = useStore((s) => s.selection)
  const doc = useStore((s) => s.document)
  const nodes = doc.nodes
  const [radius, setRadius] = useState(8)
  const editingPathId = useStore((s) => s.ui.editingPathId)
  const setEditingPath = useStore((s) => s.setEditingPath)
  const selCount = selection.length
  const canBool = selCount >= 2
  // A raster image can't do path math; the one op it supports is Intersect,
  // which clips it to the overlap and yields a new (masked) image.
  const hasImage = selection.some((id) => nodes[id] && nodes[id].type === 'image')
  const canConvex = selection.some((id) => isBooleanable(nodes[id]))
  const singlePath = selCount === 1 && nodes[selection[0]] && nodes[selection[0]].type === 'path'
  // Corner rounding reaches into groups, so it asks about the leaves.
  const canRound = radius > 0 && selectionLeaves(doc, selection).some((id) => canRoundCorners(nodes[id]))
  const editing = !!editingPathId

  // A boolean op is path math, and text carries no path — so outline any text
  // in the selection first and let the op work on the result. Text nested in a
  // selected group counts too, since a group operand is the union of its leaves.
  const outlineSelectedText = async () => {
    const st = useStore.getState()
    const text = selectionLeaves(st.document, st.selection)
      .map((id) => st.document.nodes[id])
      .filter((n) => n && n.type === 'text' && n.text && !n.locked)
    if (text.length) useStore.getState().applyTextToPaths(await outlineTextNodes(text))
  }

  // The implicit outlining and the op itself are one action to the user, so they
  // collapse into a single undo step.
  const runBoolean = async (op) => {
    beginHistoryBatch()
    try {
      await outlineSelectedText()
      const st = useStore.getState()
      const result = await performBoolean(st.document, st.selection, op)
      if (result) useStore.getState().applyBoolean(result)
    } finally {
      endHistoryBatch()
    }
  }

  const runRound = () => useStore.getState().roundCorners(selection, radius)

  const runConvex = async () => {
    const st = useStore.getState()
    const result = await performConvexHull(st.document, st.selection)
    if (result) useStore.getState().applyBoolean(result)
  }

  return (
    <div className={styles.wrap}>
      <button
        className={styles.penBtn}
        data-active={tool === 'pen' || undefined}
        onClick={() => setTool(tool === 'pen' ? 'select' : 'pen')}
      >
        <PenTool size={15} />
        Pen tool
      </button>

      <button
        className={styles.penBtn}
        data-active={editing || undefined}
        disabled={!singlePath && !editing}
        title="Edit the points of the selected path (or right-click it → Edit Points)"
        onClick={() => setEditingPath(editing ? null : selection[0])}
      >
        <Spline size={15} />
        Edit points
      </button>

      <div className={styles.boolGrid}>
        {OPS.map(({ op, label, Icon }) => {
          const blockedByImage = hasImage && op !== 'intersect'
          return (
            <button
              key={op}
              className={styles.boolBtn}
              title={
                blockedByImage
                  ? `${label} isn't available while an image is selected`
                  : hasImage && op === 'intersect'
                    ? 'Intersect — clip the image to the overlapping area'
                    : `${label} — select 2+ shapes`
              }
              disabled={!canBool || blockedByImage}
              onClick={() => runBoolean(op)}
            >
              <Icon size={16} />
              <span>{label}</span>
            </button>
          )
        })}
      </div>

      <div className={styles.roundRow}>
        <NumberInput
          value={radius}
          onChange={setRadius}
          min={0}
          title="Corner radius, in page units"
        />
        <button
          className={styles.roundBtn}
          disabled={!canRound}
          title="Round the sharp corners of the selected shapes with this radius. A rectangle keeps a live, editable radius; other shapes are baked into a rounded path."
          onClick={runRound}
        >
          <CornerUpLeft size={15} />
          Round corners
        </button>
      </div>

      <button
        className={styles.penBtn}
        disabled={!canConvex}
        title="Replace the selection with its convex hull — outermost points stay put, concavities become straight edges"
        onClick={runConvex}
      >
        <Hexagon size={15} />
        Make convex
      </button>

      <p className={styles.hint}>
        {tool === 'pen'
          ? 'Click to add points, drag for curves. Click the first point or press Enter to finish; Esc cancels.'
          : editing
            ? 'Drag points or handles to reshape. Drag a segment to add a point; Alt-click or Delete removes one. Esc to finish.'
            : hasImage
              ? 'An image only supports Intersect — it is clipped to the overlapping shape and becomes a new image.'
              : 'Select 2+ shapes, then combine them with a boolean op. Right-click a path → Edit Points to reshape it.'}
      </p>
    </div>
  )
}
