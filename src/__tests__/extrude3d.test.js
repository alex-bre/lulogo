import { describe, it, expect, beforeAll } from 'vitest'
import { useStore } from '../state/store'
import { initHistory, undo } from '../state/history'
import { createDocument } from '../model/document'
import { createRect, addNode } from '../model/nodes'
import { makeProjector, ellipsePath } from '../model/projection3d'
import { nodeSource, buildT3DSession } from '../model/transform3d'
import { extrudeFaces, bodyBase } from '../model/extrude3d'
import { parsePath } from '../model/pathEdit'

beforeAll(() => initHistory())

const projFor = (box, params) =>
  makeProjector({ projection: 'orthographic', rx: 0, ry: 0, rz: 0, perspective: 50, depth: 0, ...params }, box)

const ringPoints = (d) => parsePath(d)[0].anchors.map((a) => [a.x, a.y])
const near = (a, b, tol = 0.01) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol
const parseHex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16))

describe('extrudeFaces', () => {
  const rect = createRect({ x: 100, y: 100, width: 200, height: 120, style: { fill: '#4080c0' } })
  const box = { x: 100, y: 100, width: 200, height: 120 }
  const src = nodeSource(rect)

  it('returns nothing when depth is 0', () => {
    expect(extrudeFaces(src, projFor(box, {}), 0, rect.style)).toEqual([])
  })

  it('builds a solid: one front cap (own style) + side walls, painted back-to-front', () => {
    const proj = projFor(box, { rx: 32, ry: 24 })
    const faces = extrudeFaces(src, proj, 40, rect.style)

    const fronts = faces.filter((f) => f.role === 'front')
    const sides = faces.filter((f) => f.role === 'side')
    expect(fronts).toHaveLength(1)
    expect(fronts[0].fill).toBeNull() // caller paints it with the node's own style
    expect(sides.length).toBeGreaterThanOrEqual(2)

    // Front cap is nearest the viewer, so it is painted last (on top).
    expect(faces[faces.length - 1].role).toBe('front')
  })

  it('places the front cap exactly on the flat projection of the outline', () => {
    const proj = projFor(box, { rx: 32, ry: 24 })
    const front = extrudeFaces(src, proj, 40, rect.style).find((f) => f.role === 'front')
    const ring = ringPoints(front.d)
    // Each of the rect's four corners, projected, must be a vertex of the cap.
    for (const c of [[100, 100], [300, 100], [300, 220], [100, 220]]) {
      const p = proj.pt(c[0], c[1], 0)
      expect(ring.some((q) => near(q, p))).toBe(true)
    }
  })

  it('shades side walls darker than the fill (and greys a non-colour fill)', () => {
    const proj = projFor(box, { rx: 32, ry: 24 })
    const base = [0x40, 0x80, 0xc0]
    for (const f of extrudeFaces(src, proj, 40, rect.style).filter((f) => f.role !== 'front')) {
      const rgb = parseHex(f.fill)
      // every channel no brighter than the fill → reads as a shaded body
      rgb.forEach((v, i) => expect(v).toBeLessThanOrEqual(base[i] + 1))
    }
    // gradient / none fills fall back to neutral grey
    expect(bodyBase({ fill: 'url(#g)' })).toEqual([150, 150, 150])
    expect(bodyBase({ fill: null })).toEqual([150, 150, 150])
  })

  it('taper shrinks the back cross-section by the set amount', () => {
    const proj = projFor(box, { ry: 180 }) // rotate to view the back cap straight on
    const width = (face) => {
      const xs = ringPoints(face.d).map((p) => p[0])
      return Math.max(...xs) - Math.min(...xs)
    }
    const back0 = extrudeFaces(src, proj, 40, rect.style, { taper: 0 }).find((f) => f.role === 'back')
    const back50 = extrudeFaces(src, proj, 40, rect.style, { taper: 0.5 }).find((f) => f.role === 'back')
    expect(back0).toBeTruthy()
    expect(back50).toBeTruthy()
    // 50% taper → the back is half the width of the untapered back.
    expect(width(back0)).toBeCloseTo(200, 1) // full rect width
    expect(width(back50) / width(back0)).toBeCloseTo(0.5, 2)
  })

  it('simplified mode collapses a round shape to one body + one cap', () => {
    const proj = projFor(box, { rx: 32, ry: 24 })
    const ellSrc = { kind: 'd', d: ellipsePath(200, 160, 100, 60) }

    const full = extrudeFaces(ellSrc, proj, 40, rect.style)
    const simple = extrudeFaces(ellSrc, proj, 40, rect.style, { simple: true })

    // Full extrusion: one wall per flattened outline edge → many faces.
    expect(full.length).toBeGreaterThan(10)
    // Simplified: a single convex body plus the artwork cap — two paths.
    expect(simple).toHaveLength(2)

    const body = simple.filter((f) => f.role !== 'front')
    const front = simple.filter((f) => f.role === 'front')
    expect(front).toHaveLength(1)
    expect(front[0].fill).toBeNull() // caller paints the cap with the node's own style
    expect(body).toHaveLength(1)
    expect(body[0].fill).toMatch(/^#[0-9a-f]{6}$/) // one flat body tone
    // Body is painted first (behind), cap last (on top).
    expect(simple[simple.length - 1].role).toBe('front')
  })

  it('simplified mode forces a single flat body tone regardless of the flat flag', () => {
    const proj = projFor(box, { rx: 32, ry: 24 })
    const ellSrc = { kind: 'd', d: ellipsePath(200, 160, 100, 60) }
    // simple implies flat, so shaded-vs-flat requests both yield one body colour
    for (const opts of [{ simple: true }, { simple: true, flat: true }]) {
      const body = extrudeFaces(ellSrc, proj, 40, rect.style, opts).filter((f) => f.role !== 'front')
      expect(new Set(body.map((f) => f.fill)).size).toBe(1)
    }
  })

  it('simplified mode shows the flat body cap when the back faces the viewer', () => {
    const proj = projFor(box, { ry: 180 }) // spun around → viewing the back
    const faces = extrudeFaces(src, proj, 40, rect.style, { simple: true })
    expect(faces.some((f) => f.role === 'front')).toBe(false)
    const back = faces.find((f) => f.role === 'back')
    expect(back).toBeTruthy()
    expect(back.fill).toMatch(/^#[0-9a-f]{6}$/) // back reads as the flat body tone, not the artwork
  })

  it('flat mode paints every body face one uniform colour', () => {
    const proj = projFor(box, { rx: 32, ry: 24 })
    const shaded = extrudeFaces(src, proj, 40, rect.style)
    const flat = extrudeFaces(src, proj, 40, rect.style, { flat: true })

    const body = (fs) => fs.filter((f) => f.role !== 'front').map((f) => f.fill)
    // shaded mode: the side/back faces take on a range of tones…
    expect(new Set(body(shaded)).size).toBeGreaterThan(1)
    // …flat mode: exactly one colour across every side + back face.
    expect(new Set(body(flat)).size).toBe(1)
    // the front cap is still the object's own style either way
    expect(flat.find((f) => f.role === 'front').fill).toBeNull()
  })
})

describe('applyT3D with thickness', () => {
  it('bakes the shape into a group of shaded face paths (one undo step)', async () => {
    const doc = createDocument()
    const rect = createRect({ x: 100, y: 100, width: 200, height: 120, style: { fill: '#4080c0' } })
    addNode(doc, rect)
    useStore.setState({ document: doc, selection: [rect.id], past: [], future: [] })

    const session = await buildT3DSession(doc, [rect.id])
    useStore.getState().startT3D(session)
    useStore.getState().setT3DParams({ rx: 32, ry: 24, depth: 40 })
    useStore.getState().applyT3D()

    const st = useStore.getState()
    // The original rect is replaced by a group…
    expect(st.document.nodes[rect.id]).toBeUndefined()
    expect(st.selection).toHaveLength(1)
    const group = st.document.nodes[st.selection[0]]
    expect(group.type).toBe('group')
    expect(group.children.length).toBeGreaterThanOrEqual(3) // front + ≥2 walls

    const children = group.children.map((id) => st.document.nodes[id])
    expect(children.every((c) => c.type === 'path')).toBe(true)
    // Exactly one face keeps the original fill (the front); the rest are shaded.
    const fronts = children.filter((c) => c.style.fill === '#4080c0')
    expect(fronts).toHaveLength(1)
    expect(children.some((c) => c.style.fill !== '#4080c0')).toBe(true)

    // Single undo restores the flat rect.
    undo()
    const after = useStore.getState().document
    expect(after.nodes[rect.id]).toBeTruthy()
    expect(after.nodes[rect.id].type).toBe('rect')
  })
})
