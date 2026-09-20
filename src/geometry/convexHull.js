import { getPaper, nodeToPaperPath, isBooleanable } from './paperBridge'
import { flattenOrder } from './boolean'

// "Make convex": replace the booleanable selection with its convex hull — the
// smallest convex outline that encloses every shape. The hull's vertices are
// actual points sampled from the shapes' outlines, so the outermost points stay
// exactly where they were (curves are only ever cut inward between samples, by
// well under a pixel at the density below). The result is a straight-edged
// path, so any concavity or curvature collapses to straight lines between the
// extreme points without shrinking the shape.

const fmt = (n) => Math.round(n * 1000) / 1000

// Gather boundary points from a Paper path or compound-path. Exact anchor
// points (rect/polygon corners) are kept verbatim; curved edges are sampled
// densely by arc length so the extreme point in every direction is captured.
function collectPoints(item, pts) {
  if (item.children && item.children.length) {
    item.children.forEach((c) => collectPoints(c, pts))
    return
  }
  if (!item.segments) return
  for (const seg of item.segments) pts.push([seg.point.x, seg.point.y])
  const len = item.length
  if (len > 0) {
    const n = Math.min(6000, Math.max(64, Math.round(len / 0.5)))
    for (let i = 0; i < n; i++) {
      const p = item.getPointAt((i / n) * len)
      if (p) pts.push([p.x, p.y])
    }
  }
}

/**
 * Convex hull of a point set via Andrew's monotone chain, O(n log n). Returns
 * the hull vertices counter-clockwise (in y-down screen space). Collinear
 * points are dropped (strict turns only), so straight edges use just their two
 * endpoints. Fewer than 3 distinct/non-collinear points → returns what it has.
 */
export function convexHull(points) {
  const sorted = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const uniq = []
  for (const p of sorted) {
    const last = uniq[uniq.length - 1]
    if (!last || last[0] !== p[0] || last[1] !== p[1]) uniq.push(p)
  }
  if (uniq.length < 3) return uniq
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const build = (seq) => {
    const stack = []
    for (const p of seq) {
      while (stack.length >= 2 && cross(stack[stack.length - 2], stack[stack.length - 1], p) <= 0) stack.pop()
      stack.push(p)
    }
    stack.pop() // drop the shared endpoint; the other chain re-adds it
    return stack
  }
  const lower = build(uniq)
  const upper = build(uniq.slice().reverse())
  return lower.concat(upper)
}

// Ramer–Douglas–Peucker on an open polyline: keep the endpoints and any point
// farther than `eps` from the running chord, recursively. Deviation is always
// measured against the ORIGINAL points, so no vertex ends up more than `eps`
// from the input — unlike neighbour-by-neighbour thinning, this can't erode a
// low-curvature region (a flat arc) inward over successive removals.
function rdp(points, eps) {
  const n = points.length
  if (n < 3) return points.slice()
  const keep = new Array(n).fill(false)
  keep[0] = keep[n - 1] = true
  const stack = [[0, n - 1]]
  while (stack.length) {
    const [s, e] = stack.pop()
    const a = points[s]
    const b = points[e]
    const base = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    let maxD = -1
    let idx = -1
    for (let i = s + 1; i < e; i++) {
      const p = points[i]
      const d = Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / base
      if (d > maxD) {
        maxD = d
        idx = i
      }
    }
    if (maxD > eps) {
      keep[idx] = true
      stack.push([s, idx], [idx, e])
    }
  }
  return points.filter((_, i) => keep[i])
}

/**
 * Simplify a convex ring, collapsing straight edges to their endpoints and
 * thinning dense curve samples, while guaranteeing every dropped point lies
 * within `eps` (px) of the kept outline. The ring is split at its min-x and
 * max-x vertices — kept exactly as anchors — so those extremes are preserved
 * precisely and the top/bottom stay within `eps`. `eps` is a small fraction of
 * a pixel, so the outermost points stay put to sub-pixel precision.
 */
function simplifyRing(ring, eps) {
  const n = ring.length
  if (n < 4) return ring
  let iMin = 0
  let iMax = 0
  for (let i = 1; i < n; i++) {
    if (ring[i][0] < ring[iMin][0]) iMin = i
    if (ring[i][0] > ring[iMax][0]) iMax = i
  }
  const chain = (from, to) => {
    const out = []
    for (let i = from; ; i = (i + 1) % n) {
      out.push(ring[i])
      if (i === to) break
    }
    return out
  }
  const a = rdp(chain(iMin, iMax), eps)
  const b = rdp(chain(iMax, iMin), eps)
  return a.concat(b.slice(1, -1)) // drop the shared min/max endpoints in b
}

/**
 * Compute the convex hull over the booleanable selection and return a plan the
 * store can apply (same shape as geometry/boolean.js → store.applyBoolean):
 * resulting path data, inherited style, the bottom-most node id for z-order,
 * and the ids to remove. Returns null when nothing usable results. Async:
 * Paper.js is lazy-loaded.
 */
export async function performConvexHull(doc, ids) {
  const order = flattenOrder(doc)
  const sel = ids
    .filter((id) => isBooleanable(doc.nodes[id]))
    .sort((x, y) => order.indexOf(x) - order.indexOf(y))
  if (!sel.length) return null

  const paper = await getPaper()
  try {
    const pts = []
    for (const id of sel) {
      const item = nodeToPaperPath(paper, doc.nodes[id])
      if (item) collectPoints(item, pts)
    }
    // Collapse straight edges to their endpoints and thin dense curve samples,
    // keeping every point within 0.01px of the outline so extremes stay put.
    const hull = simplifyRing(convexHull(pts), 0.01)
    if (hull.length < 3) return null
    const d = hull.map((p, i) => `${i ? 'L' : 'M'} ${fmt(p[0])} ${fmt(p[1])}`).join(' ') + ' Z'
    return { d, style: { ...doc.nodes[sel[0]].style }, baseId: sel[0], removeIds: sel }
  } finally {
    paper.project.activeLayer.removeChildren()
  }
}
