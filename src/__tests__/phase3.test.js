import { describe, it, expect } from 'vitest'
import { useStore } from '../state/store'
import { createDocument } from '../model/document'
import { createRect, addNode } from '../model/nodes'
import { scaleNode } from '../model/mutate'
import { rotatePointAbout } from '../model/transform'
import { selectionBBox } from '../model/bbox'
import { serializeDocument } from '../io/serialize'

// Two 100x100 rects at (0,0) and (200,200); both selected. Selection bbox is
// (0,0,300,300). setState merges, leaving the store's actions intact.
function setup() {
  const doc = createDocument()
  const a = createRect({ x: 0, y: 0, width: 100, height: 100 })
  const b = createRect({ x: 200, y: 200, width: 100, height: 100 })
  addNode(doc, a)
  addNode(doc, b)
  useStore.setState({ document: doc, selection: [a.id, b.id] })
  return { doc, a, b }
}

describe('geometry helpers', () => {
  it('scales a rect about an anchor', () => {
    const r = createRect({ x: 10, y: 10, width: 100, height: 50 })
    scaleNode(r, 0, 0, 2, 2, {})
    expect([r.x, r.y, r.width, r.height]).toEqual([20, 20, 200, 100])
  })

  it('rotates a point about a center', () => {
    const p = rotatePointAbout({ x: 1, y: 0 }, { x: 0, y: 0 }, 90)
    expect(p.x).toBeCloseTo(0)
    expect(p.y).toBeCloseTo(1)
  })
})

describe('arrange store actions', () => {
  it('resizes the selection to a target width', () => {
    setup()
    useStore.getState().resizeSelection(600, null)
    const box = selectionBBox(useStore.getState().document, useStore.getState().selection)
    expect(box.width).toBeCloseTo(600)
    expect(box.x).toBeCloseTo(0) // anchored at top-left
  })

  it('aligns selected nodes to the left edge', () => {
    const { b } = setup()
    useStore.getState().alignSelection('left', 'selection')
    expect(useStore.getState().document.nodes[b.id].x).toBe(0)
  })

  it('mirrors the selection horizontally about its center', () => {
    const { a } = setup()
    useStore.getState().flipSelection('h')
    const na = useStore.getState().document.nodes[a.id]
    expect(na.x).toBe(200) // center 50 mirrored across 150 -> 250 -> x=200
    expect(na.flipX).toBe(true)
  })

  it('rotates the selection and records rotation', () => {
    const { a } = setup()
    useStore.getState().setSelectionRotation(30)
    expect(useStore.getState().document.nodes[a.id].rotation).toBe(30)
  })
})

describe('gradient export', () => {
  it('emits a <defs> with the referenced gradient', () => {
    const doc = createDocument()
    doc.defs.gradients.g1 = {
      id: 'g1',
      type: 'linear',
      angle: 90,
      stops: [
        { offset: 0, color: '#000000', opacity: 1 },
        { offset: 1, color: '#ffffff', opacity: 1 },
      ],
    }
    const r = createRect({ x: 0, y: 0, width: 10, height: 10, style: { fill: 'url(#g1)' } })
    addNode(doc, r)
    const svg = serializeDocument(doc)
    expect(svg).toContain('<defs>')
    expect(svg).toContain('<linearGradient id="g1" gradientTransform="rotate(90 0.5 0.5)">')
    expect(svg).toContain('<stop offset="0" stop-color="#000000"/>')
    expect(svg).toContain('fill="url(#g1)"')
  })

  it('omits <defs> when no gradient is referenced', () => {
    const doc = createDocument()
    doc.defs.gradients.unused = { id: 'unused', type: 'linear', angle: 0, stops: [] }
    addNode(doc, createRect({ x: 0, y: 0, width: 10, height: 10 }))
    expect(serializeDocument(doc)).not.toContain('<defs>')
  })
})
