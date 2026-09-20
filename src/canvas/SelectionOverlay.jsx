import { geometryBBox } from '../model/bbox'
import { nodeTransform } from '../model/transform'
import styles from './CanvasView.module.css'

const HANDLE = 9 // screen px

const RESIZE_CURSOR = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
}

/** Box outline + 8 resize handles + rotate handle, drawn for the given bbox. */
function BoxWithHandles({ box, zoom }) {
  const hs = HANDLE / zoom
  const half = hs / 2
  const x2 = box.x + box.width
  const y2 = box.y + box.height
  const mx = box.x + box.width / 2
  const my = box.y + box.height / 2
  const handles = [
    ['nw', box.x, box.y],
    ['n', mx, box.y],
    ['ne', x2, box.y],
    ['e', x2, my],
    ['se', x2, y2],
    ['s', mx, y2],
    ['sw', box.x, y2],
    ['w', box.x, my],
  ]
  const rotY = box.y - 22 / zoom
  return (
    <>
      <rect
        className={styles.selectionBox}
        x={box.x}
        y={box.y}
        width={box.width}
        height={box.height}
        fill="none"
        vectorEffect="non-scaling-stroke"
        pointerEvents="none"
      />
      <line
        className={styles.handleStalk}
        x1={mx}
        y1={box.y}
        x2={mx}
        y2={rotY}
        vectorEffect="non-scaling-stroke"
        pointerEvents="none"
      />
      <circle
        className={styles.handle}
        data-handle="rotate"
        cx={mx}
        cy={rotY}
        r={half * 1.15}
        vectorEffect="non-scaling-stroke"
        style={{ cursor: 'grab' }}
      />
      {handles.map(([pos, px, py]) => (
        <rect
          key={pos}
          className={styles.handle}
          data-handle="resize"
          data-pos={pos}
          x={px - half}
          y={py - half}
          width={hs}
          height={hs}
          vectorEffect="non-scaling-stroke"
          style={{ cursor: RESIZE_CURSOR[pos] }}
        />
      ))}
    </>
  )
}

/**
 * Selection overlay (world space; non-scaling strokes stay crisp).
 *  - single line   → endpoint handles
 *  - single shape  → box drawn in the object's own rotated/flipped frame, so it
 *                    hugs the shape
 *  - multi-select  → axis-aligned union box
 */
export default function SelectionOverlay({ box, zoom, nodes }) {
  if (!box) return null
  // A single *shape* gets an oriented box; a group (or multi-selection) gets the
  // axis-aligned union box, like a unified object.
  const single = nodes && nodes.length === 1 && nodes[0].type !== 'group' ? nodes[0] : null

  if (single && single.type === 'line') {
    const r = HANDLE / 1.4 / zoom
    const ends = [
      { which: 1, x: single.x1, y: single.y1 },
      { which: 2, x: single.x2, y: single.y2 },
    ]
    return (
      <g>
        <line
          className={styles.selectionBox}
          x1={single.x1}
          y1={single.y1}
          x2={single.x2}
          y2={single.y2}
          fill="none"
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
        {ends.map((p) => (
          <circle
            key={p.which}
            className={styles.handle}
            data-handle="endpoint"
            data-id={single.id}
            data-which={p.which}
            cx={p.x}
            cy={p.y}
            r={r}
            vectorEffect="non-scaling-stroke"
            style={{ cursor: 'move' }}
          />
        ))}
      </g>
    )
  }

  if (single) {
    // Draw in the node's local frame and apply its transform so the box (and
    // its handles) rotate/flip with the object.
    return (
      <g transform={nodeTransform(single)}>
        <BoxWithHandles box={geometryBBox(single)} zoom={zoom} />
      </g>
    )
  }

  return (
    <g>
      <BoxWithHandles box={box} zoom={zoom} />
    </g>
  )
}
