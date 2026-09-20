import { describe, it, expect } from 'vitest'
import { serializeProject, parseProject } from '../io/project'
import { useStore } from '../state/store'
import { createDocument } from '../model/document'
import { createRect, createText, createGroup, addNode } from '../model/nodes'

describe('editable project files', () => {
  it('round-trips the full document through serialize/parse', () => {
    const doc = createDocument()
    const g = createGroup({ name: 'Layer 1' })
    addNode(doc, g)
    addNode(doc, createRect({ x: 1, y: 2, width: 3, height: 4, rx: 2 }), g.id)
    addNode(doc, createText({ x: 5, y: 6, text: 'hello' }))
    doc.defs.gradients.g1 = { id: 'g1', type: 'linear', angle: 45, stops: [{ offset: 0, color: '#000', opacity: 1 }] }

    const restored = parseProject(serializeProject(doc))
    expect(restored).toEqual(doc)
  })

  it('rejects files that are not projects', () => {
    expect(() => parseProject('{"foo":1}')).toThrow()
    expect(() => parseProject('not json')).toThrow()
  })

  it('loadDocument replaces the document and clears selection', () => {
    const doc = createDocument()
    addNode(doc, createRect({ x: 0, y: 0, width: 10, height: 10 }))
    useStore.setState({ selection: ['stale-id'] })

    useStore.getState().loadDocument(doc)
    const st = useStore.getState()
    expect(st.document.rootOrder).toHaveLength(1)
    expect(st.selection).toEqual([])
    expect(st.ui.editingTextId).toBe(null)
  })
})
