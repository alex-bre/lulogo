import { describe, it, expect, beforeAll } from 'vitest'
import { mergeDocumentInto } from '../model/merge'
import { useStore } from '../state/store'
import { initHistory, undo } from '../state/history'
import { createDocument } from '../model/document'
import { createRect, createEllipse, createGroup, addNode } from '../model/nodes'

beforeAll(() => initHistory())

/** The drawing being added to: one shape, and settings of its own. */
function target() {
  const doc = createDocument()
  doc.page = { width: 800, height: 600 }
  doc.background = '#ffffff'
  doc.grid = { size: 25, visible: false }
  doc.snapping = { enabled: false }
  doc.defaultStyle = { ...doc.defaultStyle, fill: '#123456' }
  addNode(doc, createRect({ x: 0, y: 0, width: 10, height: 10, name: 'Existing' }))
  return doc
}

/** The file being added: a named layer holding a gradient shape, and a loose ellipse on top. */
function source() {
  const doc = createDocument()
  doc.page = { width: 4000, height: 4000 }
  doc.background = '#000000'
  doc.grid = { size: 5, visible: true }
  doc.defs.gradients.g1 = { id: 'g1', type: 'linear', angle: 0, stops: [{ offset: 0, color: '#f00', opacity: 1 }] }
  const layer = createGroup({ name: 'Layer A' })
  addNode(doc, layer)
  const rect = createRect({ x: 120, y: 340, width: 50, height: 60, name: 'Card', style: { fill: 'url(#g1)' } })
  addNode(doc, rect, layer.id)
  const dot = createEllipse({ cx: 900, cy: 50, rx: 7, ry: 7, name: 'Dot' })
  addNode(doc, dot)
  doc.animation = {
    duration: 8000,
    clips: [{ id: 'c1', nodeId: rect.id, effect: 'fade', start: 6000, duration: 1500, easing: 'linear', params: {} }],
  }
  return { doc, layer, rect, dot }
}

const byName = (doc, name) => Object.values(doc.nodes).find((n) => n.name === name)

describe('merging a project into the current one', () => {
  it('stacks the layers on top, in their own order, with fresh ids', () => {
    const doc = target()
    const { doc: src, layer, dot } = source()
    const existing = doc.rootOrder[0]

    const created = mergeDocumentInto(doc, src)

    expect(doc.rootOrder).toEqual([existing, ...created])
    expect(created.map((id) => doc.nodes[id].name)).toEqual(['Layer A', 'Dot'])
    expect(created).not.toContain(layer.id)
    expect(created).not.toContain(dot.id)
  })

  it('keeps every object exactly where it was drawn, groups and names intact', () => {
    const doc = target()
    const { doc: src } = source()

    mergeDocumentInto(doc, src)

    const layer = byName(doc, 'Layer A')
    const card = byName(doc, 'Card')
    expect(layer.type).toBe('group')
    expect(layer.children).toEqual([card.id])
    expect(card.parent).toBe(layer.id)
    expect([card.x, card.y, card.width, card.height]).toEqual([120, 340, 50, 60])
    expect([byName(doc, 'Dot').cx, byName(doc, 'Dot').cy]).toEqual([900, 50])
  })

  it('leaves the current document’s settings alone', () => {
    const doc = target()
    const settings = JSON.parse(
      JSON.stringify({ page: doc.page, background: doc.background, grid: doc.grid, snapping: doc.snapping, defaultStyle: doc.defaultStyle }),
    )

    mergeDocumentInto(doc, source().doc)

    expect({ page: doc.page, background: doc.background, grid: doc.grid, snapping: doc.snapping, defaultStyle: doc.defaultStyle }).toEqual(settings)
  })

  it('brings the gradients the artwork paints with, under ids of its own', () => {
    const doc = target()
    doc.defs.gradients.g1 = { id: 'g1', type: 'radial', stops: [] } // same id, different gradient

    mergeDocumentInto(doc, source().doc)

    const fill = byName(doc, 'Card').style.fill
    const id = fill.match(/^url\(#(.+)\)$/)[1]
    expect(id).not.toBe('g1')
    expect(doc.defs.gradients[id].stops[0].color).toBe('#f00')
    expect(doc.defs.gradients.g1.type).toBe('radial')
  })

  it('carries animation clips across to the new nodes, growing the timeline only as far as they need', () => {
    const doc = target()
    doc.animation = { duration: 5000, clips: [] }

    mergeDocumentInto(doc, source().doc)

    expect(doc.animation.clips).toHaveLength(1)
    const [clip] = doc.animation.clips
    expect(clip.nodeId).toBe(byName(doc, 'Card').id)
    expect(clip.id).not.toBe('c1')
    expect(doc.animation.duration).toBe(7500) // clip end — not the source's 8000

    const longer = target()
    longer.animation = { duration: 20000, clips: [] }
    mergeDocumentInto(longer, source().doc)
    expect(longer.animation.duration).toBe(20000)
  })

  it('can add the same file twice without the copies colliding', () => {
    const doc = target()
    const { doc: src } = source()

    mergeDocumentInto(doc, src)
    mergeDocumentInto(doc, src)

    expect(doc.rootOrder).toHaveLength(5)
    expect(Object.values(doc.nodes).filter((n) => n.name === 'Card')).toHaveLength(2)
    expect(new Set(doc.animation.clips.map((c) => c.nodeId)).size).toBe(2)
  })

  it('does not touch the source document', () => {
    const { doc: src } = source()
    const before = JSON.parse(JSON.stringify(src))

    mergeDocumentInto(target(), src)

    expect(src).toEqual(before)
  })
})

describe('the mergeDocument store action', () => {
  it('selects what was added and undoes in one step', () => {
    const doc = target()
    useStore.setState({ document: doc, selection: [], past: [], future: [] })
    useStore.setState({ past: [], future: [] })

    useStore.getState().mergeDocument(source().doc)

    const st = useStore.getState()
    expect(st.selection.map((id) => st.document.nodes[id].name)).toEqual(['Layer A', 'Dot'])
    expect(st.past).toHaveLength(1)

    undo()
    expect(useStore.getState().document).toBe(doc)
  })
})
