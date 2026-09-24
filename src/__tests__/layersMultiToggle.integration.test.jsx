import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import LayersTab from '../panels/right/tabs/LayersTab'
import { useStore } from '../state/store'
import { createDocument } from '../model/document'
import { createRect, addNode } from '../model/nodes'

afterEach(cleanup)

function seedLayers(n) {
  const doc = createDocument()
  const ids = []
  for (let i = 0; i < n; i++) {
    const r = createRect({ name: `L${i}`, x: 0, y: 0, width: 10, height: 10 })
    addNode(doc, r)
    ids.push(r.id)
  }
  useStore.setState({ document: doc, selection: [] })
  return ids
}

const row = (label) => screen.getByText(label).closest('[draggable="true"]')
const toggle = (label, title) => row(label).querySelector(`button[title="${title}"]`)
const node = (id) => useStore.getState().document.nodes[id]

describe('Layers tab hide/lock with a multi-selection', () => {
  it('hides and shows every selected layer from one selected row', () => {
    const [a, b, c] = seedLayers(3)
    useStore.setState({ selection: [a, b] })
    render(<LayersTab />)

    fireEvent.click(toggle('L0', 'Hide'))
    expect([node(a).hidden, node(b).hidden, !!node(c).hidden]).toEqual([true, true, false])

    fireEvent.click(toggle('L1', 'Show'))
    expect([node(a).hidden, node(b).hidden]).toEqual([false, false])
  })

  it('locks every selected layer, taking the clicked row state', () => {
    const [a, b, c] = seedLayers(3)
    useStore.getState().setNodesLocked([b], true)
    useStore.setState({ selection: [a, b] })
    render(<LayersTab />)

    fireEvent.click(toggle('L0', 'Lock'))
    expect([node(a).locked, node(b).locked, !!node(c).locked]).toEqual([true, true, false])
  })

  it('toggles only the clicked row when it is not selected', () => {
    const [a, b, c] = seedLayers(3)
    useStore.setState({ selection: [a, b] })
    render(<LayersTab />)

    fireEvent.click(toggle('L2', 'Hide'))
    expect([!!node(a).hidden, !!node(b).hidden, node(c).hidden]).toEqual([false, false, true])
  })
})
