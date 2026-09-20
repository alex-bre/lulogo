import { describe, it, expect } from 'vitest'
import { useStore } from '../state/store'
import { createDocument } from '../model/document'
import { createRect, createGroup, addNode } from '../model/nodes'

const fresh = (build) => {
  const doc = createDocument()
  const refs = build ? build(doc) : {}
  useStore.setState({ document: doc, selection: [] })
  return refs
}

describe('grouping', () => {
  it('groups the selection then ungroups it', () => {
    const { a, b } = fresh((doc) => {
      const a = createRect({ x: 0, y: 0, width: 10, height: 10 })
      const b = createRect({ x: 20, y: 0, width: 10, height: 10 })
      addNode(doc, a)
      addNode(doc, b)
      return { a, b }
    })
    useStore.setState({ selection: [a.id, b.id] })

    useStore.getState().groupSelection()
    let st = useStore.getState()
    expect(st.selection).toHaveLength(1)
    const gid = st.selection[0]
    const g = st.document.nodes[gid]
    expect(g.type).toBe('group')
    expect(g.children).toEqual(expect.arrayContaining([a.id, b.id]))
    expect(st.document.nodes[a.id].parent).toBe(gid)
    expect(st.document.rootOrder).toContain(gid)
    expect(st.document.rootOrder).not.toContain(a.id)

    useStore.getState().setSelection([gid])
    useStore.getState().ungroupSelection()
    st = useStore.getState()
    expect(st.document.nodes[gid]).toBeUndefined()
    expect(st.document.rootOrder).toContain(a.id)
    expect(st.document.nodes[a.id].parent).toBe(null)
  })

  it('preserves layer (z-order) order inside the group regardless of selection order', () => {
    const { a, b, c } = fresh((doc) => {
      const a = createRect({ x: 0, y: 0, width: 10, height: 10 })
      const b = createRect({ x: 20, y: 0, width: 10, height: 10 })
      const c = createRect({ x: 40, y: 0, width: 10, height: 10 })
      addNode(doc, a) // back-most
      addNode(doc, b)
      addNode(doc, c) // front-most
      return { a, b, c }
    })
    // Select in a scrambled order — the group should still stack a,b,c.
    useStore.setState({ selection: [c.id, a.id, b.id] })

    useStore.getState().groupSelection()
    const st = useStore.getState()
    const g = st.document.nodes[st.selection[0]]
    expect(g.children).toEqual([a.id, b.id, c.id])
  })
})

describe('moveNode', () => {
  it('reorders within a container (before = in front)', () => {
    const { a, b, c } = fresh((doc) => {
      const a = createRect({ x: 0, y: 0, width: 1, height: 1 })
      const b = createRect({ x: 0, y: 0, width: 1, height: 1 })
      const c = createRect({ x: 0, y: 0, width: 1, height: 1 })
      addNode(doc, a)
      addNode(doc, b)
      addNode(doc, c)
      return { a, b, c }
    })
    useStore.getState().moveNode(a.id, c.id, 'before')
    expect(useStore.getState().document.rootOrder).toEqual([b.id, c.id, a.id])
  })

  it('reparents a node into a group', () => {
    const { a, g } = fresh((doc) => {
      const g = createGroup({ name: 'G' })
      const a = createRect({ x: 0, y: 0, width: 1, height: 1 })
      addNode(doc, g)
      addNode(doc, a)
      return { a, g }
    })
    useStore.getState().moveNode(a.id, g.id, 'inside')
    const st = useStore.getState()
    expect(st.document.nodes[a.id].parent).toBe(g.id)
    expect(st.document.nodes[g.id].children).toEqual([a.id])
    expect(st.document.rootOrder).not.toContain(a.id)
  })

  it('refuses to move a group into its own descendant', () => {
    const { outer, inner } = fresh((doc) => {
      const outer = createGroup({ name: 'Outer' })
      const inner = createGroup({ name: 'Inner' })
      addNode(doc, outer)
      addNode(doc, inner, outer.id)
      return { outer, inner }
    })
    useStore.getState().moveNode(outer.id, inner.id, 'inside')
    // unchanged: inner still inside outer
    expect(useStore.getState().document.nodes[inner.id].parent).toBe(outer.id)
  })
})

describe('placement is ungrouped by default', () => {
  it('adds new shapes at the top level (no auto group)', () => {
    fresh()
    useStore.getState().addShapeAt('rect', 100, 100)
    const st = useStore.getState()
    expect(st.document.rootOrder).toHaveLength(1)
    const node = st.document.nodes[st.document.rootOrder[0]]
    expect(node.type).toBe('rect')
    expect(node.parent).toBe(null)
    expect(st.selection).toEqual([node.id])
  })
})

describe('moveNodes (dragging a multi-selection)', () => {
  const rects = (doc, n) => {
    const out = []
    for (let i = 0; i < n; i++) {
      const r = createRect({ name: `L${i}`, x: 0, y: 0, width: 1, height: 1 })
      addNode(doc, r)
      out.push(r)
    }
    return out
  }

  it('lands the selection as one block and keeps its relative stacking', () => {
    const { ids } = fresh((doc) => ({ ids: rects(doc, 5).map((r) => r.id) }))
    const [a, b, c, d, e] = ids
    // Selection order is scrambled; the result must still stack a below c.
    useStore.getState().moveNodes([c, a], e, 'before')
    expect(useStore.getState().document.rootOrder).toEqual([b, d, e, a, c])
  })

  it('drops the whole selection into a group', () => {
    const { a, c, g } = fresh((doc) => {
      const g = createGroup({ name: 'G' })
      addNode(doc, g)
      const [a, , c] = rects(doc, 3)
      return { a, c, g }
    })
    useStore.getState().moveNodes([a.id, c.id], g.id, 'inside')
    const st = useStore.getState()
    expect(st.document.nodes[g.id].children).toEqual([a.id, c.id])
    expect(st.document.nodes[a.id].parent).toBe(g.id)
    expect(st.document.rootOrder).not.toContain(c.id)
  })

  it('leaves a member that rides along inside a moving group where it is', () => {
    const { g, child, target } = fresh((doc) => {
      const target = createRect({ name: 'Target', x: 0, y: 0, width: 1, height: 1 })
      addNode(doc, target)
      const g = createGroup({ name: 'G' })
      addNode(doc, g)
      const child = createRect({ name: 'Child', x: 0, y: 0, width: 1, height: 1 })
      addNode(doc, child, g.id)
      return { g, child, target }
    })
    // Selecting a group and its child must not tear the child out of the group.
    useStore.getState().moveNodes([g.id, child.id], target.id, 'after')
    const st = useStore.getState()
    expect(st.document.rootOrder).toEqual([g.id, target.id])
    expect(st.document.nodes[child.id].parent).toBe(g.id)
    expect(st.document.nodes[g.id].children).toEqual([child.id])
  })

  it('skips a group that would swallow the target but still moves the rest', () => {
    const { outer, inner, loose } = fresh((doc) => {
      const outer = createGroup({ name: 'Outer' })
      addNode(doc, outer)
      const inner = createGroup({ name: 'Inner' })
      addNode(doc, inner, outer.id)
      const loose = createRect({ name: 'Loose', x: 0, y: 0, width: 1, height: 1 })
      addNode(doc, loose)
      return { outer, inner, loose }
    })
    useStore.getState().moveNodes([outer.id, loose.id], inner.id, 'inside')
    const st = useStore.getState()
    expect(st.document.nodes[outer.id].parent).toBe(null) // refused
    expect(st.document.nodes[inner.id].children).toEqual([loose.id])
    expect(st.document.nodes[loose.id].parent).toBe(inner.id)
  })

  it('ignores a drop onto a row that is itself being dragged', () => {
    const { ids } = fresh((doc) => ({ ids: rects(doc, 3).map((r) => r.id) }))
    const [a, b, c] = ids
    useStore.getState().moveNodes([a, b], a, 'before')
    expect(useStore.getState().document.rootOrder).toEqual([a, b, c])
  })
})

describe('a new group takes its front-most member’s z-position', () => {
  const named = (doc, names) =>
    names.map((name) => {
      const r = createRect({ name, x: 0, y: 0, width: 1, height: 1 })
      addNode(doc, r)
      return r
    })

  it('sits where the top-most grouped object sat, not at the very top', () => {
    const { a, b, c, d } = fresh((doc) => {
      const [a, b, c, d] = named(doc, ['a', 'b', 'c', 'd'])
      return { a, b, c, d }
    })
    useStore.setState({ selection: [b.id, c.id] })
    useStore.getState().groupSelection()
    const st = useStore.getState()
    // d was in front of c and stays in front of the new group.
    expect(st.document.rootOrder).toEqual([a.id, st.selection[0], d.id])
  })

  it('lands at the front when a member was already front-most', () => {
    const { a, b, c } = fresh((doc) => {
      const [a, b, c] = named(doc, ['a', 'b', 'c'])
      return { a, b, c }
    })
    useStore.setState({ selection: [a.id, c.id] })
    useStore.getState().groupSelection()
    const st = useStore.getState()
    expect(st.document.rootOrder).toEqual([b.id, st.selection[0]])
  })

  it('keeps the position inside the parent group when grouping nested members', () => {
    const { g, x, y, z } = fresh((doc) => {
      const g = createGroup({ name: 'G' })
      addNode(doc, g)
      const kids = ['x', 'y', 'z'].map((name) => {
        const r = createRect({ name, x: 0, y: 0, width: 1, height: 1 })
        addNode(doc, r, g.id)
        return r
      })
      return { g, x: kids[0], y: kids[1], z: kids[2] }
    })
    useStore.setState({ selection: [x.id, y.id] })
    useStore.getState().groupSelection()
    const st = useStore.getState()
    const gid = st.selection[0]
    expect(st.document.nodes[g.id].children).toEqual([gid, z.id])
    expect(st.document.nodes[gid].parent).toBe(g.id)
  })
})
