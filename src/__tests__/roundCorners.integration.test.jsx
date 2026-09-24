import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { render, fireEvent, cleanup, act, waitFor } from '@testing-library/react'
import App from '../App'
import { useStore } from '../state/store'
import { createDocument } from '../model/document'
import { createRect, createEllipse, createPolygon, addNode } from '../model/nodes'
import { undo } from '../state/history'

// jsdom lacks ResizeObserver and a canvas 2D context; stub both so the app mounts.
beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  HTMLCanvasElement.prototype.getContext = () => null
})

afterEach(cleanup)

function seed(node) {
  const doc = createDocument()
  addNode(doc, node)
  useStore.setState((s) => ({
    document: doc,
    selection: [node.id],
    past: [],
    future: [],
    ui: { ...s.ui, leftCollapsed: false, leftTab: 'path', tool: 'select', t3d: null, editingTextId: null, editingPathId: null },
  }))
}

const roundButton = (container) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent.includes('Round corners'))

// The radius input sits next to the button in the same row.
const radiusInput = (container) => roundButton(container)?.parentElement?.querySelector('input')

describe('Round corners (Path tools)', () => {
  it('bakes a polygon into a rounded path in one undo step', async () => {
    const tri = createPolygon({ points: [[0, 0], [100, 0], [50, 80]] })
    seed(tri)
    const { container } = render(<App />)

    let btn
    await waitFor(() => {
      btn = roundButton(container)
      expect(btn).toBeTruthy()
    })
    expect(btn.disabled).toBe(false)

    await act(async () => {
      const input = radiusInput(container)
      fireEvent.change(input, { target: { value: '12' } })
      fireEvent.blur(input)
    })
    await act(async () => {
      fireEvent.click(roundButton(container))
    })

    const node = useStore.getState().document.nodes[tri.id]
    expect(node.type).toBe('path')
    expect(node.d).toContain('C')
    expect(node.points).toBeUndefined()

    await act(async () => {
      undo()
    })
    const back = useStore.getState().document.nodes[tri.id]
    expect(back.type).toBe('polygon')
    expect(back.points).toEqual([[0, 0], [100, 0], [50, 80]])
  })

  it('keeps a rect a rect and just sets its radius', async () => {
    const rect = createRect({ x: 0, y: 0, width: 200, height: 120 })
    seed(rect)
    const { container } = render(<App />)

    await waitFor(() => expect(roundButton(container)).toBeTruthy())
    await act(async () => {
      fireEvent.click(roundButton(container))
    })
    const node = useStore.getState().document.nodes[rect.id]
    expect(node.type).toBe('rect')
    expect(node.rx).toBe(8) // the control's default radius
  })

  it('is disabled for a shape with no corners', async () => {
    seed(createEllipse({ cx: 100, cy: 100, rx: 50, ry: 30 }))
    const { container } = render(<App />)
    await waitFor(() => expect(roundButton(container)).toBeTruthy())
    expect(roundButton(container).disabled).toBe(true)
  })
})
