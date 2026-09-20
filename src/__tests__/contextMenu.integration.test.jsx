import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import App from '../App'
import { useStore } from '../state/store'
import { createDocument } from '../model/document'
import { createRect, addNode } from '../model/nodes'

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

function seedTwoRects() {
  const doc = createDocument()
  const a = createRect({ x: 100, y: 100, width: 50, height: 50 })
  const b = createRect({ x: 300, y: 300, width: 50, height: 50 })
  addNode(doc, a)
  addNode(doc, b)
  useStore.setState((s) => ({ document: doc, selection: [], ui: { ...s.ui, tool: 'select' } }))
  return { a, b }
}

describe('canvas right-click context menu', () => {
  it('opens on an object and brings it to the front', () => {
    const { a, b } = seedTwoRects()
    const { container } = render(<App />)

    // Right-click the back-most rect (a): it selects and the menu opens.
    const el = container.querySelector(`[data-id="${a.id}"]`)
    act(() => fireEvent.contextMenu(el, { clientX: 120, clientY: 120 }))

    expect(useStore.getState().selection).toEqual([a.id])
    expect(screen.getByText('Bring to Front')).toBeTruthy()

    act(() => fireEvent.click(screen.getByText('Bring to Front')))

    // a moves to the end of rootOrder (front-most) and the menu closes.
    expect(useStore.getState().document.rootOrder).toEqual([b.id, a.id])
    expect(screen.queryByText('Bring to Front')).toBeNull()
  })

  it('deletes the object from the menu', () => {
    const { a } = seedTwoRects()
    const { container } = render(<App />)

    const el = container.querySelector(`[data-id="${a.id}"]`)
    act(() => fireEvent.contextMenu(el, { clientX: 120, clientY: 120 }))
    act(() => fireEvent.click(screen.getByText('Delete')))

    expect(useStore.getState().document.nodes[a.id]).toBeUndefined()
  })

  it('shows only Select All / Paste on empty canvas and clears selection', () => {
    const { a } = seedTwoRects()
    useStore.setState({ selection: [a.id] })
    const { container } = render(<App />)

    // Right-click the empty canvas backdrop (the svg itself has no data-id).
    const svg = container.querySelector('main > svg')
    act(() => fireEvent.contextMenu(svg, { clientX: 500, clientY: 500 }))

    expect(useStore.getState().selection).toEqual([])
    expect(screen.getByText('Select All')).toBeTruthy()
    expect(screen.queryByText('Bring to Front')).toBeNull()
  })
})
