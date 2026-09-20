import { describe, it, expect, afterEach, beforeAll } from 'vitest'
import { render, screen, fireEvent, createEvent, cleanup, act } from '@testing-library/react'
import LayersTab from '../panels/right/tabs/LayersTab'
import { useStore } from '../state/store'
import { createDocument } from '../model/document'
import { createRect, createGroup, addNode } from '../model/nodes'

afterEach(cleanup)

// jsdom gives every element a zero-sized box, so the panel cannot tell top half
// from bottom half. Pin a 20px-tall row and drive the half via clientY.
const ROW_H = 20
beforeAll(() => {
  Element.prototype.getBoundingClientRect = () => ({
    top: 0,
    left: 0,
    bottom: ROW_H,
    right: 100,
    width: 100,
    height: ROW_H,
    x: 0,
    y: 0,
  })
})

// rootOrder ends up [L0..L(n-1)]; the panel shows them reversed (front on top).
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
const dataTransfer = () => ({ effectAllowed: '', setData: () => {}, getData: () => '' })

// jsdom has no DragEvent, so Testing Library builds a plain Event that drops
// clientY on the floor — pin it on by hand.
function fireDrag(type, el, dt, clientY) {
  const ev = createEvent[type](el, { dataTransfer: dt })
  if (clientY !== undefined) Object.defineProperty(ev, 'clientY', { value: clientY })
  act(() => void fireEvent(el, ev))
}

// Drag `from` onto `to`, releasing at `clientY` within the target row. Each
// step gets its own act() so the drop indicator state lands before the release.
function dragTo(from, to, clientY) {
  const dt = dataTransfer()
  fireDrag('dragStart', row(from), dt)
  fireDrag('dragOver', row(to), dt, clientY)
  fireDrag('drop', row(to), dt, clientY)
}

// Release in the target's top ('before') or bottom ('after') half.
const drag = (from, to, half) => dragTo(from, to, half === 'before' ? 1 : ROW_H - 1)

const order = () => useStore.getState().document.rootOrder

describe('Layers panel — dragging a multi-selection', () => {
  it('moves every selected row to the drop index in one go', () => {
    const ids = seedLayers(5)
    const [l0, l1, l2, l3, l4] = ids
    useStore.setState({ selection: [l1, l3] })
    render(<LayersTab />)

    // Display order (top→bottom): L4 L3 L2 L1 L0. Drop above L0's midpoint, so
    // the pair lands directly on top of L0.
    drag('L3', 'L0', 'before')
    expect(order()).toEqual([l0, l1, l3, l2, l4])
  })

  it('drags only the grabbed row when it is outside the selection', () => {
    const ids = seedLayers(4)
    const [l0, l1, l2, l3] = ids
    useStore.setState({ selection: [l1, l2] })
    render(<LayersTab />)

    drag('L3', 'L0', 'before')
    expect(order()).toEqual([l0, l3, l1, l2])
    expect(useStore.getState().selection).toEqual([l1, l2]) // selection untouched
  })

  it('refuses a drop onto a row inside the dragged selection', () => {
    const ids = seedLayers(4)
    const [l0, l1, l2, l3] = ids
    useStore.setState({ selection: [l1, l2] })
    render(<LayersTab />)

    drag('L1', 'L2', 'before')
    expect(order()).toEqual([l0, l1, l2, l3])
  })

  it('drops a multi-selection into a group', () => {
    const doc = createDocument()
    const g = createGroup({ name: 'G' })
    addNode(doc, g)
    const a = createRect({ name: 'A', x: 0, y: 0, width: 10, height: 10 })
    const b = createRect({ name: 'B', x: 0, y: 0, width: 10, height: 10 })
    addNode(doc, a)
    addNode(doc, b)
    useStore.setState({ document: doc, selection: [a.id, b.id] })
    render(<LayersTab />)

    // Release over the middle band of a group row → 'inside'.
    dragTo('B', 'G', ROW_H / 2)
    const st = useStore.getState()
    expect(st.document.nodes[g.id].children).toEqual([a.id, b.id])
    expect(st.document.rootOrder).toEqual([g.id])
  })
})
