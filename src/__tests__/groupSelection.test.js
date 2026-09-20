import { describe, it, expect } from 'vitest'
import { useStore } from '../state/store'
import { createDocument } from '../model/document'
import { createRect, createGroup, addNode } from '../model/nodes'
import { nodeBounds, selectionBBox } from '../model/bbox'

describe('world-space bounds', () => {
  it('computes the tight axis-aligned box of a rotated rect', () => {
    const b = nodeBounds(createRect({ x: 0, y: 0, width: 100, height: 100, rotation: 45 }), {})
    expect(b.x).toBeCloseTo(-20.71, 1)
    expect(b.y).toBeCloseTo(-20.71, 1)
    expect(b.width).toBeCloseTo(141.42, 1)
    expect(b.height).toBeCloseTo(141.42, 1)
  })

  it('unions a multi-selection like a single combined shape', () => {
    const doc = createDocument()
    const a = createRect({ x: 0, y: 0, width: 10, height: 10 })
    const b = createRect({ x: 20, y: 5, width: 10, height: 10 })
    addNode(doc, a)
    addNode(doc, b)
    expect(selectionBBox(doc, [a.id, b.id])).toEqual({ x: 0, y: 0, width: 30, height: 15 })
  })
})

// A group with two rects, selected by the group.
function groupSetup() {
  const doc = createDocument()
  const g = createGroup({ name: 'G' })
  addNode(doc, g)
  const a = createRect({ x: 0, y: 0, width: 10, height: 10 })
  const b = createRect({ x: 20, y: 0, width: 10, height: 10 })
  addNode(doc, a, g.id)
  addNode(doc, b, g.id)
  useStore.setState({ document: doc, selection: [g.id] })
  return { a, b, g }
}

describe('group selection behaves like a multi-selection', () => {
  it('applies fill to the group members', () => {
    const { a, b } = groupSetup()
    useStore.getState().updateStyle([useStore.getState().selection[0]], { fill: '#ff0000' })
    const st = useStore.getState()
    expect(st.document.nodes[a.id].style.fill).toBe('#ff0000')
    expect(st.document.nodes[b.id].style.fill).toBe('#ff0000')
  })

  it("the group's selection box is the union of its members", () => {
    const { g } = groupSetup()
    const st = useStore.getState()
    expect(selectionBBox(st.document, [g.id])).toEqual({ x: 0, y: 0, width: 30, height: 10 })
  })

  it('rotates the members rigidly about the group center', () => {
    const { a } = groupSetup()
    useStore.getState().setSelectionRotation(90) // about group center (15, 5)
    const na = useStore.getState().document.nodes[a.id]
    expect(na.rotation).toBe(90)
    // member a (center 5,5) swings to center (15, -5): x 0->10, y 0->-10
    expect(na.x).toBeCloseTo(10, 3)
    expect(na.y).toBeCloseTo(-10, 3)
  })
})
