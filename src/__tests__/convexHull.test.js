import { describe, it, expect, beforeAll } from 'vitest'
import { useStore } from '../state/store'
import { createDocument } from '../model/document'
import { createRect, createEllipse, createPath, createPolygon, addNode } from '../model/nodes'
import { convexHull, performConvexHull } from '../geometry/convexHull'
import { parsePath } from '../model/pathEdit'

// jsdom has no canvas 2D context; Paper only needs it for rendering, not path
// math. Stub a no-op context so paper.setup() succeeds (same as phase5).
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = function () {
    return new Proxy(
      { canvas: this, measureText: () => ({ width: 0 }) },
      { get: (t, p) => (p in t ? t[p] : () => {}) },
    )
  }
})

// A ring is convex iff all its turns share one orientation. Turns whose
// cross-product magnitude is below `eps` are treated as straight (ignores
// sub-pixel noise from 3-decimal path rounding); a real concavity produces a
// large opposite-sign turn, so this still fails on non-convex input.
function isConvex(ring, eps = 1e-2) {
  const n = ring.length
  let pos = 0
  let neg = 0
  for (let i = 0; i < n; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % n]
    const c = ring[(i + 2) % n]
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
    if (cross > eps) pos++
    else if (cross < -eps) neg++
  }
  return pos === 0 || neg === 0
}

// Does the hull ring pass through point p (within tol)?
function ringHasPoint(ring, p, tol = 0.5) {
  return ring.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) <= tol)
}

const ringOf = (d) => parsePath(d)[0].anchors.map((a) => [a.x, a.y])

describe('convexHull (monotone chain)', () => {
  it('drops interior and collinear points, keeping the enclosing corners', () => {
    const pts = [
      [0, 0], [10, 0], [10, 10], [0, 10], // square corners
      [5, 5], // interior — must be dropped
      [5, 0], // collinear on the bottom edge — must be dropped
    ]
    const hull = convexHull(pts)
    expect(hull).toHaveLength(4)
    for (const c of [[0, 0], [10, 0], [10, 10], [0, 10]]) expect(ringHasPoint(hull, c, 1e-9)).toBe(true)
    expect(ringHasPoint(hull, [5, 5], 1e-9)).toBe(false)
    expect(isConvex(hull)).toBe(true)
  })
})

describe('performConvexHull', () => {
  it('keeps a rotated rect\'s outermost corners exactly and stays convex', async () => {
    const doc = createDocument()
    // 45°-rotated square centered at (100,100), half-diagonal 50√2 ≈ 70.71 →
    // corners land on the axis extremes at center ± 70.71.
    const r = createRect({ x: 50, y: 50, width: 100, height: 100, rx: 0 })
    r.rotation = 45
    addNode(doc, r)

    const plan = await performConvexHull(doc, [r.id])
    expect(plan).toBeTruthy()
    const ring = ringOf(plan.d)
    expect(ring).toHaveLength(4) // straight edges collapse to the four corners
    expect(isConvex(ring)).toBe(true)
    for (const corner of [[100, 29.289], [170.711, 100], [100, 170.711], [29.289, 100]]) {
      expect(ringHasPoint(ring, corner, 0.01)).toBe(true)
    }
  })

  it('collapses a concave (arrow/star-like) path to its enclosing hull without shrinking it', async () => {
    const doc = createDocument()
    // A concave "arrow" pointing right: the notch at (50,50) is interior and
    // must vanish; the tip (100,50) and the back corners must survive.
    const d = 'M 0 0 L 100 50 L 0 100 L 50 50 Z'
    const p = createPath({ d })
    addNode(doc, p)

    const plan = await performConvexHull(doc, [p.id])
    const ring = ringOf(plan.d)
    expect(isConvex(ring)).toBe(true)
    // Extreme points preserved.
    for (const ext of [[0, 0], [100, 50], [0, 100]]) expect(ringHasPoint(ring, ext, 0.5)).toBe(true)
    // The concave notch is gone.
    expect(ringHasPoint(ring, [50, 50], 0.5)).toBe(false)
  })

  it('preserves an ellipse\'s outer extent (no inward shrink at the outermost points)', async () => {
    const doc = createDocument()
    const e = createEllipse({ cx: 100, cy: 100, rx: 80, ry: 40 })
    addNode(doc, e)

    const plan = await performConvexHull(doc, [e.id])
    const ring = ringOf(plan.d)
    expect(isConvex(ring)).toBe(true)

    const xs = ring.map((p) => p[0])
    const ys = ring.map((p) => p[1])
    const minx = Math.min(...xs)
    const maxx = Math.max(...xs)
    const miny = Math.min(...ys)
    const maxy = Math.max(...ys)
    // The outermost extent matches the ellipse's bounds to sub-0.02px — the
    // shape is NOT shrunk at its outermost points, in any axis direction.
    expect(minx).toBeCloseTo(20, 2)
    expect(maxx).toBeCloseTo(180, 2)
    expect(miny).toBeCloseTo(60, 2)
    expect(maxy).toBeCloseTo(140, 2)
    // And the hull never bulges past the ellipse's bounding box.
    for (const [x, y] of ring) {
      expect(x).toBeGreaterThanOrEqual(20 - 1e-6)
      expect(x).toBeLessThanOrEqual(180 + 1e-6)
      expect(y).toBeGreaterThanOrEqual(60 - 1e-6)
      expect(y).toBeLessThanOrEqual(140 + 1e-6)
    }
  })

  it('applies through the store: operands replaced by one convex path (one undo step)', async () => {
    const doc = createDocument()
    const a = createPolygon({ points: [[0, 0], [40, 0], [40, 40], [0, 40]], closed: true })
    const b = createRect({ x: 60, y: 60, width: 40, height: 40 })
    addNode(doc, a)
    addNode(doc, b)
    useStore.setState({ document: doc, selection: [a.id, b.id], past: [], future: [] })

    const plan = await performConvexHull(useStore.getState().document, [a.id, b.id])
    useStore.getState().applyBoolean(plan)

    const st = useStore.getState()
    expect(st.document.nodes[a.id]).toBeUndefined()
    expect(st.document.nodes[b.id]).toBeUndefined()
    expect(st.selection).toHaveLength(1)
    const out = st.document.nodes[st.selection[0]]
    expect(out.type).toBe('path')
    // Hull of the two boxes spans the full extent (0,0)–(100,100).
    const ring = ringOf(out.d)
    for (const ext of [[0, 0], [100, 100]]) expect(ringHasPoint(ring, ext, 0.5)).toBe(true)
    expect(isConvex(ring)).toBe(true)
  })

  it('returns null when nothing booleanable is selected', async () => {
    const doc = createDocument()
    const p = createPath({ d: 'M 0 0 L 10 0' }) // open line-ish path is still booleanable, so use a line node
    addNode(doc, p)
    // A line node is NOT booleanable.
    const { createLine } = await import('../model/nodes')
    const l = createLine({ x1: 0, y1: 0, x2: 10, y2: 10 })
    addNode(doc, l)
    expect(await performConvexHull(doc, [l.id])).toBeNull()
  })
})
