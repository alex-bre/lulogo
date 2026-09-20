import { describe, it, expect } from 'vitest'
import { useStore } from '../state/store'
import { createDocument } from '../model/document'
import { createRect, addNode } from '../model/nodes'

describe('fitPageToContent', () => {
  it('resizes the page to the scene and moves the top-left to (0,0)', () => {
    const doc = createDocument()
    addNode(doc, createRect({ x: 30, y: 50, width: 100, height: 60 })) // -> 30,50 .. 130,110
    addNode(doc, createRect({ x: 200, y: 100, width: 40, height: 40 })) // -> 200,100 .. 240,140
    useStore.setState({ document: doc, selection: [] })

    useStore.getState().fitPageToContent()
    const st = useStore.getState()

    // union: (30,50) .. (240,140) => 210 x 90
    expect(st.document.page.width).toBe(210)
    expect(st.document.page.height).toBe(90)

    const [a, b] = st.document.rootOrder.map((id) => st.document.nodes[id])
    expect([a.x, a.y]).toEqual([0, 0])
    expect([b.x, b.y]).toEqual([170, 50])
  })

  it('does nothing for an empty document', () => {
    useStore.setState({ document: createDocument(), selection: [] })
    const before = useStore.getState().document.page
    useStore.getState().fitPageToContent()
    expect(useStore.getState().document.page).toEqual(before)
  })
})
