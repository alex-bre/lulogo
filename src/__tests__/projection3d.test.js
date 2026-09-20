import { describe, it, expect, beforeAll } from 'vitest'
import {
  T3D_DEFAULTS,
  ISO_PRESETS,
  wrapAngle,
  isIdentityT3D,
  makeProjector,
  projectPathData,
  parseToCubics,
  roundedRectPath,
  ellipsePath,
  faceVisibility,
  cubeCorners,
  CUBE_FACES,
} from '../model/projection3d'
import { nodeSource, projectSource, sessionBounds, buildT3DSession, nodeBakeMatrix } from '../model/transform3d'
import { transformPathData } from '../model/pathTransform'
import { pathBBox } from '../model/pathBBox'
import { createDocument } from '../model/document'
import { createRect, createEllipse, createLine, createPolygon, createImage, addNode } from '../model/nodes'
import { useStore } from '../state/store'

// jsdom has no canvas 2D context; text measurement falls back gracefully but a
// stub keeps any incidental measure calls harmless (same trick as phase5).
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = function () {
    return new Proxy(
      { canvas: this, measureText: () => ({ width: 0 }) },
      { get: (t, p) => (p in t ? t[p] : () => {}) },
    )
  }
})

// A 100×100 box centered on the origin keeps the projector's pivot at (0,0),
// so projected points can be compared against hand-computed vectors directly.
const BOX = { x: -50, y: -50, width: 100, height: 100 }
const P = (over = {}) => ({ ...T3D_DEFAULTS, ...over })

const len = ([x, y]) => Math.hypot(x, y)

describe('angles', () => {
  it('wraps to (-180, 180]', () => {
    expect(wrapAngle(190)).toBe(-170)
    expect(wrapAngle(-190)).toBe(170)
    expect(wrapAngle(360)).toBe(0)
    expect(wrapAngle(180)).toBe(180)
    expect(wrapAngle(-180)).toBe(180)
  })
  it('detects identity params', () => {
    expect(isIdentityT3D(P())).toBe(true)
    expect(isIdentityT3D(P({ rx: 360 }))).toBe(true)
    expect(isIdentityT3D(P({ ry: 10 }))).toBe(false)
  })
})

describe('orthographic projection', () => {
  it('is the identity at zero angles', () => {
    const proj = makeProjector(P(), BOX)
    expect(proj.pt(30, -20)).toEqual([30, -20])
  })

  it('pure Z rotation matches SVG rotate() (clockwise, y down)', () => {
    const proj = makeProjector(P({ rz: 90 }), BOX)
    const [x, y] = proj.pt(10, 0)
    expect(x).toBeCloseTo(0, 6)
    expect(y).toBeCloseTo(10, 6)
  })

  it('+ry foreshortens x (turn about the vertical axis)', () => {
    const proj = makeProjector(P({ ry: 60 }), BOX)
    const [x, y] = proj.pt(10, 0)
    expect(x).toBeCloseTo(5, 6) // cos 60°
    expect(y).toBeCloseTo(0, 6)
  })

  it('isometric presets: ±30°/vertical edges with √(2/3) foreshortening', () => {
    const TAN30 = Math.tan(Math.PI / 6)
    for (const [name, preset] of Object.entries(ISO_PRESETS)) {
      const proj = makeProjector(P(preset), BOX)
      const o = proj.pt(0, 0)
      for (const v of [proj.pt(1, 0), proj.pt(0, 1)]) {
        const e = [v[0] - o[0], v[1] - o[1]]
        expect(len(e), `${name} edge length`).toBeCloseTo(Math.sqrt(2 / 3), 4)
        // Every iso edge is either vertical or slopes at exactly 30°.
        const slopeOk = Math.abs(e[0]) < 1e-9 || Math.abs(Math.abs(e[1] / e[0]) - TAN30) < 1e-4
        expect(slopeOk, `${name} edge slope`).toBe(true)
      }
    }
  })
})

describe('perspective projection', () => {
  it('keeps the pivot fixed and converges the receding edge', () => {
    const proj = makeProjector(P({ projection: 'perspective', rx: 40 }), BOX)
    expect(proj.pt(0, 0)).toEqual([0, 0])
    // +rx sends the bottom (y+) away: the bottom edge projects narrower.
    const [tlx] = proj.pt(-50, -50)
    const [trx] = proj.pt(50, -50)
    const [blx] = proj.pt(-50, 50)
    const [brx] = proj.pt(50, 50)
    expect(trx - tlx).toBeGreaterThan(brx - blx)
    expect(brx - blx).toBeGreaterThan(0)
  })

  it('maps straight lines to straight lines', () => {
    const proj = makeProjector(P({ projection: 'perspective', rx: 35, ry: 25, perspective: 80 }), BOX)
    const [a, b, c] = [proj.pt(0, 0), proj.pt(20, 10), proj.pt(40, 20)]
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    expect(Math.abs(cross)).toBeLessThan(1e-6)
  })

  it('higher strength converges harder', () => {
    const soft = makeProjector(P({ projection: 'perspective', rx: 40, perspective: 10 }), BOX)
    const hard = makeProjector(P({ projection: 'perspective', rx: 40, perspective: 90 }), BOX)
    const width = (proj) => proj.pt(50, 50)[0] - proj.pt(-50, 50)[0]
    expect(width(hard)).toBeLessThan(width(soft))
  })
})

describe('path data projection', () => {
  const D = 'M 0 0 L 40 0 C 50 10 60 30 40 40 Z'

  it('orthographic projection equals the affine transform of the path', () => {
    const deg = 30
    const proj = makeProjector(P({ rz: deg }), BOX)
    const r = (deg * Math.PI) / 180
    const affine = transformPathData(D, [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0])
    expect(projectPathData(D, proj)).toBe(affine)
  })

  it('subdivides curves under perspective for accuracy', () => {
    const proj = makeProjector(P({ projection: 'perspective', rx: 50, perspective: 90 }), BOX)
    const out = projectPathData(D, proj)
    const curves = (out.match(/C /g) || []).length
    expect(curves).toBeGreaterThan(1) // the single source cubic was split
    expect(out).toMatch(/^M /)
    expect(out.trim()).toMatch(/Z$/)
  })

  it('normalizes H/V/S/Q/T/A to lines and cubics', () => {
    const segs = parseToCubics('M 0 0 H 10 V 10 Q 15 15 20 10 T 30 10 S 40 0 50 10 A 5 5 0 0 1 60 10')
    const cmds = new Set(segs.map((s) => s.c))
    expect([...cmds].every((c) => ['M', 'L', 'C', 'Z'].includes(c))).toBe(true)
    // Arc endpoint is preserved exactly.
    const last = segs[segs.length - 1]
    expect(last.x).toBeCloseTo(60, 3)
    expect(last.y).toBeCloseTo(10, 3)
  })

  it('shape path helpers produce closed data', () => {
    expect(roundedRectPath(0, 0, 10, 10)).toBe('M 0 0 L 10 0 L 10 10 L 0 10 Z')
    expect(roundedRectPath(0, 0, 10, 10, 2)).toContain('C')
    const e = ellipsePath(0, 0, 10, 5)
    expect(e).toMatch(/^M 10 0 C/)
    expect(e).toMatch(/Z$/)
  })
})

describe('node sources (rotation/flip baked)', () => {
  it('bakes a line rotation into its endpoints', () => {
    const line = createLine({ x1: 0, y1: 0, x2: 10, y2: 0, rotation: 90 })
    const src = nodeSource(line)
    expect(src.kind).toBe('line')
    expect(src.x1).toBeCloseTo(5, 6)
    expect(src.y1).toBeCloseTo(-5, 6)
    expect(src.x2).toBeCloseTo(5, 6)
    expect(src.y2).toBeCloseTo(5, 6)
  })

  it('keeps polygons as point lists and rects as path data', () => {
    const poly = createPolygon({ points: [[0, 0], [10, 0], [5, 8]] })
    expect(nodeSource(poly)).toEqual({ kind: 'points', points: [[0, 0], [10, 0], [5, 8]], closed: true })
    const rect = createRect({ x: 0, y: 0, width: 20, height: 10 })
    expect(nodeSource(rect)).toEqual({ kind: 'd', d: 'M 0 0 L 20 0 L 20 10 L 0 10 Z' })
  })

  it('returns no bake matrix for an upright node', () => {
    expect(nodeBakeMatrix(createRect({}))).toBeNull()
    const m = nodeBakeMatrix(createRect({ x: 0, y: 0, width: 10, height: 10, rotation: 180 }))
    // 180° about the center (5,5): (0,0) → (10,10)
    expect(m[0] * 0 + m[2] * 0 + m[4]).toBeCloseTo(10, 6)
    expect(m[1] * 0 + m[3] * 0 + m[5]).toBeCloseTo(10, 6)
  })
})

describe('preview cube', () => {
  it('shows the front face and hides the back face at rest', () => {
    const proj = makeProjector(P(), BOX)
    const corners = cubeCorners(BOX, 50)
    const vis = faceVisibility(proj, corners)
    const frontIdx = CUBE_FACES.findIndex((f) => f.front)
    expect(vis[frontIdx]).toBe(true)
    expect(vis[(frontIdx + 1) % 6]).toBe(false) // back
    expect(vis.filter(Boolean).length).toBe(1) // head-on: only the front face
  })

  it('reveals a side face after turning', () => {
    const proj = makeProjector(P({ ry: 45 }), BOX)
    const vis = faceVisibility(proj, cubeCorners(BOX, 50))
    expect(vis.filter(Boolean).length).toBeGreaterThan(1)
  })
})

describe('store: 3D transform sessions', () => {
  const seed = (nodes) => {
    const doc = createDocument()
    nodes.forEach((n) => addNode(doc, n))
    useStore.setState({ document: doc, selection: nodes.map((n) => n.id), past: [], future: [] })
    useStore.getState().cancelT3D()
    return doc
  }

  it('builds a session, applies a Y turn, and bakes shapes to projected geometry', async () => {
    const rect = createRect({ x: 0, y: 0, width: 100, height: 50 })
    const doc = seed([rect])
    const session = await buildT3DSession(doc, [rect.id])
    expect(session.ids).toEqual([rect.id])

    useStore.getState().startT3D(session)
    useStore.getState().setT3DParams({ ry: 60 })
    useStore.getState().applyT3D()

    const n = useStore.getState().document.nodes[rect.id]
    expect(n.type).toBe('path')
    expect(n.rotation).toBe(0)
    // cos 60° halves the width about the center (50, 25); height unchanged.
    const b = pathBBox(n.d)
    expect(b.width).toBeCloseTo(50, 2)
    expect(b.height).toBeCloseTo(50, 2)
    expect(b.x + b.width / 2).toBeCloseTo(50, 2)
    expect(useStore.getState().ui.t3d).toBeNull()
  })

  it('lines stay lines and polygons stay polygons', async () => {
    const line = createLine({ x1: 0, y1: 0, x2: 100, y2: 0 })
    const poly = createPolygon({ points: [[0, 20], [100, 20], [50, 80]] })
    const doc = seed([line, poly])
    const session = await buildT3DSession(doc, [line.id, poly.id])
    useStore.getState().startT3D(session)
    useStore.getState().setT3DParams({ rx: 30, ry: 20, rz: 10 })
    useStore.getState().applyT3D()

    const st = useStore.getState().document.nodes
    expect(st[line.id].type).toBe('line')
    expect(st[poly.id].type).toBe('polygon')
    expect(st[poly.id].points).toHaveLength(3)
  })

  it('identity apply leaves the document untouched (no history noise)', async () => {
    const rect = createRect({ x: 0, y: 0, width: 10, height: 10 })
    const doc = seed([rect])
    const before = useStore.getState().document
    const session = await buildT3DSession(doc, [rect.id])
    useStore.getState().startT3D(session)
    useStore.getState().applyT3D() // all angles zero
    expect(useStore.getState().document).toBe(before)
    expect(useStore.getState().document.nodes[rect.id].type).toBe('rect')
  })

  it('includes images, skips locked nodes; image-only selections yield a session', async () => {
    const img = createImage({ x: 0, y: 0, width: 10, height: 10, href: 'x' })
    const locked = createRect({ x: 0, y: 0, width: 10, height: 10, locked: true })
    const rect = createRect({ x: 20, y: 0, width: 10, height: 10 })
    const doc = seed([img, locked, rect])
    const session = await buildT3DSession(doc, [img.id, locked.id, rect.id])
    expect(session.ids).toEqual([img.id, rect.id]) // image kept, locked dropped

    const imgOnly = await buildT3DSession(doc, [img.id])
    expect(imgOnly).toBeTruthy()
    expect(imgOnly.ids).toEqual([img.id])
  })

  it('applies one shared projection to a whole group (rigid selection)', async () => {
    const a = createRect({ x: 0, y: 0, width: 10, height: 100 })
    const b = createRect({ x: 90, y: 0, width: 10, height: 100 })
    const doc = createDocument()
    addNode(doc, a)
    addNode(doc, b)
    useStore.setState({ document: doc, selection: [a.id, b.id], past: [], future: [] })

    const session = await buildT3DSession(doc, [a.id, b.id])
    expect(sessionBounds(doc, session.ids)).toEqual({ x: 0, y: 0, width: 100, height: 100 })
    useStore.getState().startT3D(session)
    useStore.getState().setT3DParams({ projection: 'perspective', rx: 45, perspective: 80 })
    useStore.getState().applyT3D()

    const nodes = useStore.getState().document.nodes
    // Shared pivot: the two bars converge symmetrically about x = 50.
    const ba = pathBBox(nodes[a.id].d)
    const bb = pathBBox(nodes[b.id].d)
    expect(ba.x + ba.width / 2 + (bb.x + bb.width / 2)).toBeCloseTo(100, 1)
    expect(ba.width).toBeCloseTo(bb.width, 3)
  })

  it('projectSource rounds line endpoints', () => {
    const proj = makeProjector(P({ rz: 45 }), BOX)
    const out = projectSource({ kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 }, proj)
    expect(out.type).toBe('line')
    expect(out.geom.x1).toBeCloseTo(0, 3)
  })
})
