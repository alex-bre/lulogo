import { textWidth, textLines, lineStep, firstBaselineOffset, widthScaleOf } from './textMetrics'
import { pathBBox } from './pathBBox'
import { transformPathData } from './pathTransform'

// Untransformed (rotation/flip ignored) geometry bounds in page coordinates.
// Path bounds that need real measurement are computed via Paper.js where used;
// this covers the analytic cases plus a measured box for text.

export function geometryBBox(node) {
  switch (node.type) {
    case 'rect':
    case 'image':
      return { x: node.x, y: node.y, width: node.width, height: node.height }
    case 'ellipse':
      return { x: node.cx - node.rx, y: node.cy - node.ry, width: node.rx * 2, height: node.ry * 2 }
    case 'line':
      return {
        x: Math.min(node.x1, node.x2),
        y: Math.min(node.y1, node.y2),
        width: Math.abs(node.x2 - node.x1),
        height: Math.abs(node.y2 - node.y1),
      }
    case 'polygon': {
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const [px, py] of node.points) {
        minX = Math.min(minX, px)
        minY = Math.min(minY, py)
        maxX = Math.max(maxX, px)
        maxY = Math.max(maxY, py)
      }
      if (minX === Infinity) return { x: 0, y: 0, width: 0, height: 0 }
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
    }
    case 'text': {
      // SVG text y is the *first line's* baseline. The block is one line box
      // (lineStep) per line, with the first baseline sitting one
      // firstBaselineOffset below the top — the same layout the inline editor's
      // textarea uses, so the two agree exactly.
      // widthScale stretches the glyphs horizontally about the anchor, so the
      // block's width grows by it (height is unaffected).
      const w = textWidth(node) * widthScaleOf(node)
      const h = textLines(node).length * lineStep(node)
      let x = node.x
      if (node.align === 'middle') x = node.x - w / 2
      else if (node.align === 'end') x = node.x - w
      return { x, y: node.y - firstBaselineOffset(node), width: w, height: h }
    }
    case 'path':
      return pathBBox(node.d)
    default:
      return { x: 0, y: 0, width: 0, height: 0 }
  }
}

export function nodeCenter(node) {
  const b = geometryBBox(node)
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}

function bboxOfPoints(pts) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of pts) {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  if (minX === Infinity) return { x: 0, y: 0, width: 0, height: 0 }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * True axis-aligned bounds of a node *as rendered* — i.e. with its rotation +
 * flip baked in — and, for a group, the union over its descendants. This is the
 * "as if unified" box used for selections, marquee, and alignment.
 */
export function nodeBounds(node, nodes) {
  if (!node) return null
  if (node.type === 'group') {
    return unionBBox(node.children.map((id) => nodeBounds(nodes[id], nodes)))
  }
  const lb = geometryBBox(node)

  // A baked affine (3D-transformed image): bounds are the transformed rect.
  if (node.matrix) {
    const [a, b, c, d, e, f] = node.matrix
    const tp = (x, y) => [a * x + c * y + e, b * x + d * y + f]
    return bboxOfPoints([
      tp(lb.x, lb.y),
      tp(lb.x + lb.width, lb.y),
      tp(lb.x + lb.width, lb.y + lb.height),
      tp(lb.x, lb.y + lb.height),
    ])
  }

  if (!node.rotation && !node.flipX && !node.flipY) return lb

  const cx = lb.x + lb.width / 2
  const cy = lb.y + lb.height / 2
  const fx = node.flipX ? -1 : 1
  const fy = node.flipY ? -1 : 1
  const r = ((node.rotation || 0) * Math.PI) / 180
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  // matrix: flip about center, then rotate about center
  const a = cos * fx
  const b = sin * fx
  const c = -sin * fy
  const d = cos * fy
  const e = cx - (a * cx + c * cy)
  const f = cy - (b * cx + d * cy)
  const tp = (x, y) => [a * x + c * y + e, b * x + d * y + f]

  // Use the real geometry where it makes the box tight; corners otherwise.
  if (node.type === 'path') return pathBBox(transformPathData(node.d, [a, b, c, d, e, f]))
  if (node.type === 'polygon') return bboxOfPoints(node.points.map(([x, y]) => tp(x, y)))
  if (node.type === 'line') return bboxOfPoints([tp(node.x1, node.y1), tp(node.x2, node.y2)])
  return bboxOfPoints([
    tp(lb.x, lb.y),
    tp(lb.x + lb.width, lb.y),
    tp(lb.x + lb.width, lb.y + lb.height),
    tp(lb.x, lb.y + lb.height),
  ])
}

/** Union of several bboxes; returns null for an empty/all-null list. */
export function unionBBox(boxes) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const b of boxes) {
    if (!b) continue
    minX = Math.min(minX, b.x)
    minY = Math.min(minY, b.y)
    maxX = Math.max(maxX, b.x + b.width)
    maxY = Math.max(maxY, b.y + b.height)
  }
  if (minX === Infinity) return null
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * Selection bounds. A single shape uses its *local* geometry box (so Arrange
 * shows the shape's own size and the overlay can draw an oriented box); a group
 * or multi-selection uses the tight union of rendered bounds ("as if unified").
 */
export function selectionBBox(doc, ids) {
  if (ids.length === 1) {
    const n = doc.nodes[ids[0]]
    // A matrix-transformed image has no meaningful upright local box; use its
    // rendered (axis-aligned) bounds so the overlay encloses it correctly.
    if (n && n.matrix) return nodeBounds(n, doc.nodes)
    if (n && n.type !== 'group') return geometryBBox(n)
  }
  return unionBBox(ids.map((id) => nodeBounds(doc.nodes[id], doc.nodes)))
}
