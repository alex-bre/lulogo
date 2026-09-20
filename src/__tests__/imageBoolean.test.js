import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'

// The DOM raster step (an <img> decode + <canvas>) isn't available in jsdom, so
// stub it: the geometry (which operands, the intersection region + its bounds)
// is what these tests exercise. The stub echoes back the bounds it was handed.
vi.mock('../geometry/imageMask', () => ({
  rasterizeImageIntersection: vi.fn(async (node, d, bounds) => ({
    href: `masked:${node.id}:${d}`,
    width: bounds.width,
    height: bounds.height,
  })),
}))

import { useStore } from '../state/store'
import { createDocument } from '../model/document'
import { createRect, createEllipse, createGroup, createImage, addNode } from '../model/nodes'
import { performBoolean } from '../geometry/boolean'
import { rasterizeImageIntersection } from '../geometry/imageMask'

// Mirrors phase5/booleanGroup: give Paper a no-op 2D context so paper.setup()
// succeeds headlessly.
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = function () {
    return new Proxy(
      { canvas: this, measureText: () => ({ width: 0 }) },
      { get: (t, p) => (p in t ? t[p] : () => {}) },
    )
  }
})

beforeEach(() => {
  rasterizeImageIntersection.mockClear()
  useStore.setState({ document: createDocument(), selection: [], past: [], future: [] })
})

// An image and a rect that overlaps its lower-right quarter.
function imageAndRect() {
  const doc = createDocument()
  const img = createImage({ name: 'Photo', x: 0, y: 0, width: 100, height: 100, href: 'data:image/png;base64,AAAA' })
  addNode(doc, img)
  const r = createRect({ name: 'Clip', x: 50, y: 50, width: 100, height: 100 })
  addNode(doc, r)
  return { doc, img, r }
}

describe('boolean ops with a raster image', () => {
  it('refuses union / subtract / exclude when an image is selected', async () => {
    const { doc, img, r } = imageAndRect()
    for (const op of ['union', 'subtract', 'exclude']) {
      expect(await performBoolean(doc, [img.id, r.id], op)).toBeNull()
    }
    expect(rasterizeImageIntersection).not.toHaveBeenCalled()
  })

  it('intersect clips the image to the overlap and shrinks it to that box', async () => {
    const { doc, img, r } = imageAndRect()
    useStore.setState({ document: doc, selection: [img.id, r.id] })

    const plan = await performBoolean(doc, [img.id, r.id], 'intersect')
    expect(plan.kind).toBe('image-intersect')
    expect(plan.baseId).toBe(img.id)
    // Overlap of image (0,0,100,100) and rect (50,50,100,100) → (50,50,50,50).
    expect(plan.image).toMatchObject({ x: 50, y: 50, width: 50, height: 50 })
    expect(rasterizeImageIntersection).toHaveBeenCalledOnce()
    const [srcNode, , bounds] = rasterizeImageIntersection.mock.calls[0]
    expect(srcNode.id).toBe(img.id)
    expect(bounds).toMatchObject({ x: 50, y: 50, width: 50, height: 50 })

    useStore.getState().applyBoolean(plan)
    const st = useStore.getState()
    // Both operands gone, replaced by a single new image, now selected.
    expect(st.document.nodes[img.id]).toBeUndefined()
    expect(st.document.nodes[r.id]).toBeUndefined()
    expect(st.selection).toHaveLength(1)
    const out = st.document.nodes[st.selection[0]]
    expect(out.type).toBe('image')
    expect(out).toMatchObject({ x: 50, y: 50, width: 50, height: 50 })
    expect(out.href).toContain('masked:')
    expect(st.document.rootOrder).toEqual([out.id])
  })

  it('carries the source image style onto the result', async () => {
    const doc = createDocument()
    const img = createImage({ x: 0, y: 0, width: 100, height: 100, href: 'data:,x', style: { opacity: 0.4 } })
    addNode(doc, img)
    const r = createRect({ x: 20, y: 20, width: 40, height: 40 })
    addNode(doc, r)
    useStore.setState({ document: doc, selection: [img.id, r.id] })

    useStore.getState().applyBoolean(await performBoolean(doc, [img.id, r.id], 'intersect'))
    const st = useStore.getState()
    expect(st.document.nodes[st.selection[0]].style.opacity).toBe(0.4)
  })

  it('passes the intersection outline (not just its box) to the rasteriser', async () => {
    // Ellipse fully inside the image → the region is the ellipse, a non-rect
    // outline; the mask path must describe curves, not a rectangle.
    const doc = createDocument()
    const img = createImage({ x: 0, y: 0, width: 200, height: 200, href: 'data:,x' })
    addNode(doc, img)
    const e = createEllipse({ cx: 100, cy: 100, rx: 60, ry: 40 })
    addNode(doc, e)

    const plan = await performBoolean(doc, [img.id, e.id], 'intersect')
    const regionData = rasterizeImageIntersection.mock.calls[0][1]
    expect(regionData).toMatch(/[cC]/) // has bezier segments — not an axis-aligned rect
    expect(plan.image).toMatchObject({ x: 40, y: 60, width: 120, height: 80 })
  })

  it('returns null when the image and the shape do not overlap', async () => {
    const doc = createDocument()
    const img = createImage({ x: 0, y: 0, width: 50, height: 50, href: 'data:,x' })
    addNode(doc, img)
    const r = createRect({ x: 500, y: 500, width: 50, height: 50 })
    addNode(doc, r)
    expect(await performBoolean(doc, [img.id, r.id], 'intersect')).toBeNull()
  })

  it('needs something to intersect the image with', async () => {
    const doc = createDocument()
    const img = createImage({ x: 0, y: 0, width: 50, height: 50, href: 'data:,x' })
    addNode(doc, img)
    expect(await performBoolean(doc, [img.id], 'intersect')).toBeNull()
  })

  it('intersects the image against a group (its union)', async () => {
    const doc = createDocument()
    const img = createImage({ x: 0, y: 0, width: 100, height: 100, href: 'data:,x' })
    addNode(doc, img)
    const a = createRect({ x: 60, y: 10, width: 60, height: 30 })
    const b = createRect({ x: 60, y: 60, width: 60, height: 30 })
    const g = createGroup({ name: 'G' })
    addNode(doc, g)
    addNode(doc, a, g.id)
    addNode(doc, b, g.id)
    useStore.setState({ document: doc, selection: [img.id, g.id] })

    const plan = await performBoolean(doc, [img.id, g.id], 'intersect')
    expect(plan.kind).toBe('image-intersect')
    // Union of the two bars spans x 60..100 (clipped to the image), y 10..90.
    expect(plan.image.x).toBeCloseTo(60, 6)
    expect(plan.image.y).toBeCloseTo(10, 6)
    expect(plan.image.width).toBeCloseTo(40, 6)
    expect(plan.image.height).toBeCloseTo(80, 6)
    useStore.getState().applyBoolean(plan)
    const st = useStore.getState()
    expect(st.document.nodes[g.id]).toBeUndefined()
    expect(st.document.nodes[st.selection[0]].type).toBe('image')
  })

  it('keeps the result at the source image z-position inside its parent', async () => {
    const doc = createDocument()
    const below = createRect({ name: 'below', x: 0, y: 0, width: 10, height: 10 })
    addNode(doc, below)
    const img = createImage({ x: 0, y: 0, width: 100, height: 100, href: 'data:,x' })
    addNode(doc, img)
    const above = createRect({ name: 'above', x: 0, y: 0, width: 10, height: 10 })
    addNode(doc, above)
    const clip = createEllipse({ cx: 50, cy: 50, rx: 30, ry: 30 })
    addNode(doc, clip)
    useStore.setState({ document: doc, selection: [img.id, clip.id] })

    useStore.getState().applyBoolean(await performBoolean(doc, [img.id, clip.id], 'intersect'))
    const st = useStore.getState()
    // below, <new image>, above — the image kept its slot; clip is gone.
    expect(st.document.rootOrder.map((id) => st.document.nodes[id].name)).toEqual(['below', 'Image', 'above'])
  })
})
