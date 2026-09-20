import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import App from '../App'
import { useStore } from '../state/store'
import { createDocument } from '../model/document'
import { createRect, createPath, createGroup, addNode } from '../model/nodes'

// jsdom lacks ResizeObserver and a canvas 2D context; stub both so the canvas
// mounts and text metrics fall back cleanly.
beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  HTMLCanvasElement.prototype.getContext = () => null
})

afterEach(cleanup)

// A group of two rects, plus a loose path outside it.
function seedGroup() {
  const doc = createDocument()
  const g = createGroup({ name: 'G' })
  addNode(doc, g)
  const a = createRect({ x: 0, y: 0, width: 10, height: 10 })
  const b = createRect({ x: 20, y: 0, width: 10, height: 10 })
  addNode(doc, a, g.id)
  addNode(doc, b, g.id)
  const p = createPath({ d: 'M 100 100 L 150 100 L 150 150' })
  addNode(doc, p)
  useStore.setState((s) => ({
    document: doc,
    selection: [],
    ui: { ...s.ui, tool: 'select', editingPathId: null, editingTextId: null, t3d: null },
  }))
  return { a, b, g, p }
}

const pointerDown = (el) =>
  act(() => {
    el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, clientY: 10 }))
  })

describe('double-click drills into a group', () => {
  it('selects the group on a click and its member on a double-click', () => {
    const { a, g } = seedGroup()
    const { container } = render(<App />)
    const el = container.querySelector(`[data-id="${a.id}"]`)

    pointerDown(el)
    expect(useStore.getState().selection).toEqual([g.id])

    act(() => fireEvent.dblClick(el))
    expect(useStore.getState().selection).toEqual([a.id])
  })

  it('keeps later clicks inside the entered group, and leaves on empty canvas', () => {
    const { a, b, g } = seedGroup()
    const { container } = render(<App />)

    act(() => fireEvent.dblClick(container.querySelector(`[data-id="${a.id}"]`)))
    // A sibling now takes the click directly instead of re-selecting the group.
    pointerDown(container.querySelector(`[data-id="${b.id}"]`))
    expect(useStore.getState().selection).toEqual([b.id])

    // Clicking empty canvas clears, so the next click selects the group again.
    // (An empty-space click is a zero-size marquee — it clears on release.)
    pointerDown(container.querySelector('main > svg'))
    act(() => {
      window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
    })
    expect(useStore.getState().selection).toEqual([])
    pointerDown(container.querySelector(`[data-id="${a.id}"]`))
    expect(useStore.getState().selection).toEqual([g.id])
  })

  it('no longer enters point-edit mode on a double-clicked path', () => {
    const { p } = seedGroup()
    const { container } = render(<App />)
    const el = container.querySelector(`[data-id="${p.id}"]`)

    pointerDown(el)
    act(() => fireEvent.dblClick(el))

    expect(useStore.getState().selection).toEqual([p.id])
    expect(useStore.getState().ui.editingPathId).toBeNull()
  })
})

describe('Edit Points in the context menu', () => {
  it('enters point-edit mode for a selected path', () => {
    const { p } = seedGroup()
    const { container } = render(<App />)

    const el = container.querySelector(`[data-id="${p.id}"]`)
    act(() => fireEvent.contextMenu(el, { clientX: 120, clientY: 120 }))
    expect(useStore.getState().selection).toEqual([p.id])

    act(() => fireEvent.click(screen.getByText('Edit Points')))
    expect(useStore.getState().ui.editingPathId).toBe(p.id)
  })

  it('is disabled when the selection is not a single path', () => {
    const { a } = seedGroup()
    const { container } = render(<App />)

    // Right-clicking a group member selects the group — not a single path.
    act(() => fireEvent.contextMenu(container.querySelector(`[data-id="${a.id}"]`), { clientX: 10, clientY: 10 }))

    expect(screen.getByText('Edit Points').closest('button').disabled).toBe(true)
  })
})
