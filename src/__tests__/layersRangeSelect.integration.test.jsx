import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import LayersTab from '../panels/right/tabs/LayersTab'
import { useStore } from '../state/store'
import { createDocument } from '../model/document'
import { createRect, createGroup, addNode } from '../model/nodes'

afterEach(cleanup)

// rootOrder ends up [L0..L(n-1)]; the panel shows them reversed (newest on top),
// so the top-to-bottom display order is L(n-1) … L0.
function seedLayers(n) {
  const doc = createDocument()
  const ids = []
  for (let i = 0; i < n; i++) {
    const r = createRect({ name: `L${i}`, x: i * 10, y: 0, width: 10, height: 10 })
    addNode(doc, r)
    ids.push(r.id)
  }
  useStore.setState({ document: doc, selection: [] })
  return ids
}

const sel = () => useStore.getState().selection
const clickRow = (label, opts) => act(() => void fireEvent.click(screen.getByText(label), opts))

describe('Layers panel — Shift range-select', () => {
  it('selects every row between the first click and the Shift-click', () => {
    const ids = seedLayers(6)
    render(<LayersTab />)

    clickRow('L5') // top row = anchor
    expect(sel()).toEqual([ids[5]])

    clickRow('L0', { shiftKey: true }) // Shift-click the bottom row
    expect(sel()).toHaveLength(6)
    expect(new Set(sel())).toEqual(new Set(ids))
  })

  it('selects a middle sub-range, in display order', () => {
    const ids = seedLayers(6)
    render(<LayersTab />)

    clickRow('L4')
    clickRow('L1', { shiftKey: true })
    // display order L5,L4,L3,L2,L1,L0 → L4..L1
    expect(sel()).toEqual([ids[4], ids[3], ids[2], ids[1]])
  })

  it('keeps the anchor fixed across repeated Shift-clicks', () => {
    const ids = seedLayers(6)
    render(<LayersTab />)

    clickRow('L3') // anchor
    clickRow('L1', { shiftKey: true })
    expect(sel()).toEqual([ids[3], ids[2], ids[1]])

    // Anchor is still L3, so Shift-clicking above it re-ranges from L3.
    clickRow('L5', { shiftKey: true })
    expect(sel()).toEqual([ids[5], ids[4], ids[3]])
  })

  it('falls back to a single selection when there is no anchor yet', () => {
    const ids = seedLayers(4)
    render(<LayersTab />)

    // First interaction is a Shift-click (no prior anchor) → just that row.
    clickRow('L2', { shiftKey: true })
    expect(sel()).toEqual([ids[2]])
  })

  it('includes an expanded group and its children in the range', () => {
    const doc = createDocument()
    const top = createRect({ name: 'Top' })
    const g = createGroup({ name: 'G' })
    addNode(doc, top)
    addNode(doc, g)
    const c0 = createRect({ name: 'C0' })
    const c1 = createRect({ name: 'C1' })
    addNode(doc, c0, g.id)
    addNode(doc, c1, g.id)
    const bottom = createRect({ name: 'Bottom' })
    addNode(doc, bottom)
    useStore.setState({ document: doc, selection: [] })
    render(<LayersTab />)

    // Display order (top→bottom): Bottom, G, C1, C0, Top  (group expanded).
    clickRow('Bottom')
    clickRow('Top', { shiftKey: true })
    expect(new Set(sel())).toEqual(new Set([bottom.id, g.id, c1.id, c0.id, top.id]))
  })
})
