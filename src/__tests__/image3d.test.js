import { describe, it, expect, beforeAll } from 'vitest'
import { useStore } from '../state/store'
import { initHistory, undo } from '../state/history'
import { createDocument } from '../model/document'
import { createImage, addNode } from '../model/nodes'
import { makeProjector } from '../model/projection3d'
import { nodeSource, projectSource, buildT3DSession } from '../model/transform3d'
import { nodeTransform } from '../model/transform'
import { nodeBounds } from '../model/bbox'
import { translateNode, scaleNode } from '../model/mutate'

beforeAll(() => initHistory())

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

const projFor = (box, params) =>
  makeProjector({ projection: 'orthographic', rx: 0, ry: 0, rz: 0, perspective: 50, depth: 0, ...params }, box)

const applyM = ([a, b, c, d, e, f], x, y) => [a * x + c * y + e, b * x + d * y + f]

describe('image 3D projection (affine)', () => {
  const img = createImage({ x: 100, y: 100, width: 200, height: 120, href: PNG })
  const box = { x: 100, y: 100, width: 200, height: 120 }

  it('is the identity matrix when unrotated (orthographic)', () => {
    const patch = projectSource(nodeSource(img), projFor(box, {}))
    expect(patch.type).toBe('image')
    expect(patch.geom.matrix).toEqual([1, 0, 0, 1, 0, 0])
    expect(patch.geom.href).toBe(PNG)
  })

  it('maps every rect corner onto its projected position (exact affine)', () => {
    const proj = projFor(box, { rx: 22, ry: 38, rz: 10 })
    const m = projectSource(nodeSource(img), proj).geom.matrix
    for (const [x, y] of [[100, 100], [300, 100], [300, 220], [100, 220]]) {
      const got = applyM(m, x, y)
      const exp = proj.pt(x, y) // z = 0
      // within ~0.05px — the affine is exact; the small gap is the matrix's
      // 3-decimal rounding amplified across the coordinates.
      expect(got[0]).toBeCloseTo(exp[0], 1)
      expect(got[1]).toBeCloseTo(exp[1], 1)
    }
  })

  it('is skipped in perspective (SVG images cannot do perspective)', () => {
    const proj = makeProjector({ projection: 'perspective', rx: 20, ry: 20, rz: 0, perspective: 60, depth: 0 }, box)
    expect(projectSource(nodeSource(img), proj)).toBeNull()
  })
})

describe('matrix as a first-class image transform', () => {
  it('renders as a matrix() transform and reports transformed bounds', () => {
    const m = createImage({ x: 0, y: 0, width: 100, height: 50, href: PNG })
    m.matrix = [1, 0, 0, 1, 10, 20]
    expect(nodeTransform(m)).toBe('matrix(1 0 0 1 10 20)')
    expect(nodeBounds(m, {})).toMatchObject({ x: 10, y: 20, width: 100, height: 50 })
  })

  it('moves by shifting the matrix (not the source rect)', () => {
    const m = createImage({ x: 0, y: 0, width: 100, height: 50, href: PNG })
    m.matrix = [1, 0, 0, 1, 10, 20]
    translateNode(m, 5, 7)
    expect(m.matrix).toEqual([1, 0, 0, 1, 15, 27])
    expect(m.x).toBe(0) // source rect untouched
  })

  it('resizes by composing the scale into the matrix', () => {
    const m = createImage({ x: 0, y: 0, width: 100, height: 50, href: PNG })
    m.matrix = [1, 0, 0, 1, 15, 27]
    scaleNode(m, 0, 0, 2, 2) // scale ×2 about the origin
    expect(m.matrix).toEqual([2, 0, 0, 2, 30, 54])
  })
})

describe('applyT3D on an image', () => {
  it('bakes to an image carrying the affine matrix (one undo step)', async () => {
    const doc = createDocument()
    const image = createImage({ x: 100, y: 100, width: 200, height: 120, href: PNG })
    addNode(doc, image)
    useStore.setState({ document: doc, selection: [image.id], past: [], future: [] })

    const session = await buildT3DSession(doc, [image.id])
    expect(session).toBeTruthy() // images are no longer skipped
    useStore.getState().startT3D(session)
    useStore.getState().setT3DParams({ rx: 20, ry: 45 }) // orthographic
    useStore.getState().applyT3D()

    const out = useStore.getState().document.nodes[image.id]
    expect(out.type).toBe('image')
    expect(out.href).toBe(PNG)
    expect(out.matrix).toHaveLength(6)
    expect(out.matrix).not.toEqual([1, 0, 0, 1, 0, 0]) // actually transformed
    expect(out.rotation).toBe(0)

    undo()
    expect(useStore.getState().document.nodes[image.id].matrix).toBeUndefined()
  })

  it('leaves images flat in perspective', async () => {
    const doc = createDocument()
    const image = createImage({ x: 100, y: 100, width: 200, height: 120, href: PNG })
    addNode(doc, image)
    useStore.setState({ document: doc, selection: [image.id], past: [], future: [] })

    const session = await buildT3DSession(doc, [image.id])
    useStore.getState().startT3D(session)
    useStore.getState().setT3DParams({ projection: 'perspective', rx: 20, ry: 45, perspective: 60 })
    useStore.getState().applyT3D()

    const out = useStore.getState().document.nodes[image.id]
    expect(out.type).toBe('image')
    expect(out.matrix).toBeUndefined() // unchanged
  })
})
