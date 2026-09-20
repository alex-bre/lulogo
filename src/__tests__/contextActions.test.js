import { describe, it, expect, beforeAll } from 'vitest'
import { useStore } from '../state/store'
import { initHistory } from '../state/history'
import { createDocument } from '../model/document'
import { createRect, createGroup, addNode } from '../model/nodes'
import { cropDocumentToSelection } from '../io/cropDocument'

beforeAll(() => initHistory())

function reset(doc = createDocument()) {
  useStore.setState({ document: doc, selection: [], past: [], future: [] })
  useStore.setState({ past: [], future: [] })
}

// Build a doc with `n` top-level rects; returns their ids in rootOrder order
// (back-to-front, so the last id is the front-most / topmost layer).
function flatDoc(n) {
  const doc = createDocument()
  const ids = []
  for (let i = 0; i < n; i++) {
    const r = createRect({ x: i * 20, y: 0, width: 10, height: 10 })
    addNode(doc, r)
    ids.push(r.id)
  }
  return { doc, ids }
}

describe('reorderNodes (z-order)', () => {
  it('brings a node to the front (end of rootOrder)', () => {
    const { doc, ids } = flatDoc(4) // [A, B, C, D]
    reset(doc)
    useStore.getState().reorderNodes([ids[1]], 'front')
    expect(useStore.getState().document.rootOrder).toEqual([ids[0], ids[2], ids[3], ids[1]])
  })

  it('sends a node to the back (start of rootOrder)', () => {
    const { doc, ids } = flatDoc(4)
    reset(doc)
    useStore.getState().reorderNodes([ids[2]], 'back')
    expect(useStore.getState().document.rootOrder).toEqual([ids[2], ids[0], ids[1], ids[3]])
  })

  it('moves a node one step forward and backward', () => {
    const { doc, ids } = flatDoc(4)
    reset(doc)
    useStore.getState().reorderNodes([ids[1]], 'forward')
    expect(useStore.getState().document.rootOrder).toEqual([ids[0], ids[2], ids[1], ids[3]])
    useStore.getState().reorderNodes([ids[1]], 'backward')
    expect(useStore.getState().document.rootOrder).toEqual([ids[0], ids[1], ids[2], ids[3]])
  })

  it('keeps a contiguous multi-selection together and preserves relative order', () => {
    const { doc, ids } = flatDoc(4) // [A, B, C, D]
    reset(doc)
    useStore.getState().reorderNodes([ids[1], ids[2]], 'front')
    expect(useStore.getState().document.rootOrder).toEqual([ids[0], ids[3], ids[1], ids[2]])
  })

  it('is a no-op at the boundary (front node moved forward)', () => {
    const { doc, ids } = flatDoc(3)
    reset(doc)
    useStore.getState().reorderNodes([ids[2]], 'forward')
    expect(useStore.getState().document.rootOrder).toEqual(ids)
  })

  it('reorders within a group without escaping it', () => {
    const doc = createDocument()
    const g = createGroup({ name: 'G' })
    doc.nodes[g.id] = g
    doc.rootOrder.push(g.id)
    const kids = ['x', 'y', 'z'].map(() => createRect({ width: 10, height: 10 }))
    for (const k of kids) {
      k.parent = g.id
      doc.nodes[k.id] = k
      g.children.push(k.id)
    }
    reset(doc)
    useStore.getState().reorderNodes([kids[0].id], 'front')
    const gAfter = useStore.getState().document.nodes[g.id]
    expect(gAfter.children).toEqual([kids[1].id, kids[2].id, kids[0].id])
    expect(useStore.getState().document.rootOrder).toEqual([g.id])
  })

  it('records a single undo step', () => {
    const { doc, ids } = flatDoc(3)
    reset(doc)
    useStore.getState().reorderNodes([ids[0]], 'front')
    expect(useStore.getState().past).toHaveLength(1)
  })
})

describe('removeClipsForNode', () => {
  it('removes only the target node’s clips', () => {
    const { doc, ids } = flatDoc(2)
    reset(doc)
    const st = useStore.getState()
    st.addEffectClips([ids[0]], 'fadeIn')
    st.addEffectClips([ids[1]], 'pulse')
    expect(useStore.getState().document.animation.clips).toHaveLength(2)

    useStore.getState().removeClipsForNode(ids[0])
    const clips = useStore.getState().document.animation.clips
    expect(clips).toHaveLength(1)
    expect(clips[0].nodeId).toBe(ids[1])
  })

  it('clears the selected clip if it belonged to the removed node', () => {
    const { doc, ids } = flatDoc(1)
    reset(doc)
    useStore.getState().addEffectClips([ids[0]], 'fadeIn')
    const clipId = useStore.getState().document.animation.clips[0].id
    useStore.getState().selectClip(clipId)
    useStore.getState().removeClipsForNode(ids[0])
    expect(useStore.getState().ui.anim.selectedClipId).toBeNull()
  })
})

describe('cropDocumentToSelection', () => {
  it('keeps only the selection, crops the page, and shifts to the origin', () => {
    const doc = createDocument()
    doc.background = '#101820'
    const a = createRect({ x: 100, y: 120, width: 50, height: 40 })
    const b = createRect({ x: 400, y: 400, width: 80, height: 80 })
    addNode(doc, a)
    addNode(doc, b)

    const out = cropDocumentToSelection(doc, [a.id])
    expect(out.rootOrder).toEqual([a.id])
    expect(out.nodes[b.id]).toBeUndefined()
    expect(out.page).toEqual({ width: 50, height: 40 })
    expect(out.nodes[a.id].x).toBe(0)
    expect(out.nodes[a.id].y).toBe(0)
    // The document background is preserved (cropped to the new page).
    expect(out.background).toBe('#101820')
  })

  it('does not mutate the source document', () => {
    const doc = createDocument()
    const a = createRect({ x: 100, y: 100, width: 20, height: 20 })
    addNode(doc, a)
    cropDocumentToSelection(doc, [a.id])
    expect(doc.nodes[a.id].x).toBe(100)
    expect(doc.page).toEqual({ width: 1200, height: 1754 })
  })

  it('promotes a node selected inside a group to the top level', () => {
    const doc = createDocument()
    const g = createGroup({ name: 'G' })
    doc.nodes[g.id] = g
    doc.rootOrder.push(g.id)
    const x = createRect({ x: 200, y: 200, width: 60, height: 60 })
    x.parent = g.id
    doc.nodes[x.id] = x
    g.children.push(x.id)

    const out = cropDocumentToSelection(doc, [x.id])
    expect(out.rootOrder).toEqual([x.id])
    expect(out.nodes[x.id].parent).toBeNull()
    expect(out.nodes[g.id]).toBeUndefined()
    expect(out.page).toEqual({ width: 60, height: 60 })
  })

  it('unions bounds for a multi-selection', () => {
    const doc = createDocument()
    const a = createRect({ x: 100, y: 100, width: 50, height: 50 }) // -> 100..150
    const b = createRect({ x: 200, y: 130, width: 50, height: 50 }) // -> 200..250 / 130..180
    addNode(doc, a)
    addNode(doc, b)

    const out = cropDocumentToSelection(doc, [a.id, b.id])
    expect(out.page).toEqual({ width: 150, height: 80 }) // x:100..250, y:100..180
    expect(out.nodes[a.id].x).toBe(0)
    expect(out.nodes[b.id].x).toBe(100)
    expect(out.nodes[b.id].y).toBe(30)
  })

  it('returns the original doc when nothing is selected', () => {
    const doc = createDocument()
    expect(cropDocumentToSelection(doc, [])).toBe(doc)
  })
})
