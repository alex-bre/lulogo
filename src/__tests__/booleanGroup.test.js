import { describe, it, expect, beforeAll } from 'vitest'
import { useStore } from '../state/store'
import { createDocument } from '../model/document'
import { createRect, createEllipse, createGroup, addNode } from '../model/nodes'
import { performBoolean } from '../geometry/boolean'

// jsdom has no canvas 2D context; Paper only needs it for rendering, not path
// math. Stub a no-op context so paper.setup() succeeds (mirrors phase5).
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = function () {
    return new Proxy(
      { canvas: this, measureText: () => ({ width: 0 }) },
      { get: (t, p) => (p in t ? t[p] : () => {}) },
    )
  }
})

// A group of two stacked rects (A on top of B) with an ellipse cutter that
// straddles their shared edge, so subtract/intersect touch both. Returns the
// document plus the node ids. z-order: [group, cutter] → group is the base.
function groupAndCutter() {
  const doc = createDocument()
  const a = createRect({ name: 'A', x: 0, y: 0, width: 100, height: 100 })
  const b = createRect({ name: 'B', x: 0, y: 100, width: 100, height: 100 })
  const g = createGroup({ name: 'G' })
  addNode(doc, g)
  addNode(doc, a, g.id)
  addNode(doc, b, g.id)
  const c = createEllipse({ name: 'C', cx: 50, cy: 100, rx: 30, ry: 30 })
  addNode(doc, c)
  return { doc, g, a, b, c }
}

describe('boolean ops with a group operand', () => {
  it('subtract distributes across group members and keeps the group', async () => {
    const { doc, g, a, b, c } = groupAndCutter()
    useStore.setState({ document: doc, selection: [g.id, c.id] })

    const plan = await performBoolean(doc, [g.id, c.id], 'subtract')
    expect(plan.kind).toBe('group-distribute')
    expect(plan.groupId).toBe(g.id)
    useStore.getState().applyBoolean(plan)

    const st = useStore.getState()
    const group = st.document.nodes[g.id]
    // Group survives with both members, each now a cut path.
    expect(group).toBeTruthy()
    expect(group.type).toBe('group')
    expect(group.children).toHaveLength(2)
    for (const cid of group.children) {
      expect(st.document.nodes[cid].type).toBe('path')
      expect(st.document.nodes[cid].parent).toBe(g.id)
    }
    // The originals and the cutter are gone; the group is selected.
    expect(st.document.nodes[a.id]).toBeUndefined()
    expect(st.document.nodes[b.id]).toBeUndefined()
    expect(st.document.nodes[c.id]).toBeUndefined()
    expect(st.selection).toEqual([g.id])
  })

  it('members each keep their own style when distributing', async () => {
    const doc = createDocument()
    const a = createRect({ x: 0, y: 0, width: 100, height: 100, style: { fill: '#ff0000' } })
    const b = createRect({ x: 0, y: 100, width: 100, height: 100, style: { fill: '#00ff00' } })
    const g = createGroup({ name: 'G' })
    addNode(doc, g)
    addNode(doc, a, g.id)
    addNode(doc, b, g.id)
    const c = createEllipse({ cx: 50, cy: 100, rx: 30, ry: 30 })
    addNode(doc, c)
    useStore.setState({ document: doc, selection: [g.id, c.id] })

    useStore.getState().applyBoolean(await performBoolean(doc, [g.id, c.id], 'subtract'))

    const st = useStore.getState()
    const fills = st.document.nodes[g.id].children.map((id) => st.document.nodes[id].style.fill)
    expect(new Set(fills)).toEqual(new Set(['#ff0000', '#00ff00']))
  })

  it('intersect drops members the cutter never touches', async () => {
    const doc = createDocument()
    const near = createRect({ name: 'near', x: 0, y: 0, width: 100, height: 100 })
    const far = createRect({ name: 'far', x: 500, y: 500, width: 100, height: 100 })
    const g = createGroup({ name: 'G' })
    addNode(doc, g)
    addNode(doc, near, g.id)
    addNode(doc, far, g.id)
    const c = createEllipse({ cx: 50, cy: 50, rx: 40, ry: 40 })
    addNode(doc, c)
    useStore.setState({ document: doc, selection: [g.id, c.id] })

    useStore.getState().applyBoolean(await performBoolean(doc, [g.id, c.id], 'intersect'))

    const st = useStore.getState()
    const group = st.document.nodes[g.id]
    expect(group.children).toHaveLength(1) // only the overlapping member survives
    expect(st.document.nodes[group.children[0]].type).toBe('path')
    expect(st.document.nodes[far.id]).toBeUndefined()
  })

  it('treats a non-base group as one object (single merged path)', async () => {
    const doc = createDocument()
    // Cutter at the bottom, group above → the plain shape is the base.
    const c = createEllipse({ name: 'C', cx: 50, cy: 100, rx: 80, ry: 120 })
    addNode(doc, c)
    const a = createRect({ x: 0, y: 0, width: 100, height: 100 })
    const b = createRect({ x: 0, y: 100, width: 100, height: 100 })
    const g = createGroup({ name: 'G' })
    addNode(doc, g)
    addNode(doc, a, g.id)
    addNode(doc, b, g.id)
    useStore.setState({ document: doc, selection: [c.id, g.id] })

    const plan = await performBoolean(doc, [c.id, g.id], 'subtract')
    expect(plan.kind).toBeUndefined() // ordinary single-path plan
    useStore.getState().applyBoolean(plan)

    const st = useStore.getState()
    expect(st.document.nodes[g.id]).toBeUndefined() // group consumed
    expect(st.document.nodes[a.id]).toBeUndefined()
    expect(st.selection).toHaveLength(1)
    expect(st.document.nodes[st.selection[0]].type).toBe('path')
  })

  it('union flattens a group into one path (never distributes)', async () => {
    const { doc, g, c } = groupAndCutter()
    useStore.setState({ document: doc, selection: [g.id, c.id] })

    const plan = await performBoolean(doc, [g.id, c.id], 'union')
    expect(plan.kind).toBeUndefined()
    useStore.getState().applyBoolean(plan)

    const st = useStore.getState()
    expect(st.document.nodes[g.id]).toBeUndefined()
    expect(st.selection).toHaveLength(1)
    expect(st.document.nodes[st.selection[0]].type).toBe('path')
  })
})
