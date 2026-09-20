import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { render, fireEvent, cleanup, act, waitFor } from '@testing-library/react'
import App from '../App'
import { useStore } from '../state/store'
import { createDocument } from '../model/document'
import { createRect, createEllipse, addNode } from '../model/nodes'
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

// Seed a document with one node selected and the Style tab open.
function seed(node) {
  const doc = createDocument()
  addNode(doc, node)
  useStore.setState((s) => ({
    document: doc,
    selection: [node.id],
    past: [],
    future: [],
    ui: { ...s.ui, tool: 'select', rightTab: 'style', t3d: null, editingTextId: null, editingPathId: null },
  }))
}

// Find the radius NumberInput by walking up from its "Radius" label.
function radiusInput(container) {
  const label = [...container.querySelectorAll('label, span, div')].find((el) => el.textContent === 'Radius')
  return label ? label.closest('*')?.parentElement?.querySelector('input') : null
}

describe('rect corner-radius control (Style tab)', () => {
  it('shows a radius control for a selected rect and writes node.rx', async () => {
    const rect = createRect({ x: 100, y: 100, width: 200, height: 120, rx: 16 })
    seed(rect)
    const { container } = render(<App />)

    // The control appears and reflects the current radius.
    let input
    await waitFor(() => {
      input = radiusInput(container)
      expect(input).toBeTruthy()
    })
    expect(input.value).toBe('16')

    // Editing it updates the node's top-level rx (not its style).
    await act(async () => {
      fireEvent.change(input, { target: { value: '40' } })
      fireEvent.blur(input)
    })
    expect(useStore.getState().document.nodes[rect.id].rx).toBe(40)
    expect(useStore.getState().document.nodes[rect.id].style.rx).toBeUndefined()

    // The rendered SVG <rect> picks up the new radius.
    await waitFor(() => {
      const svgRect = container.querySelector(`[data-id="${rect.id}"]`) || container.querySelector('svg rect[rx]')
      expect(svgRect?.getAttribute('rx')).toBe('40')
    })

    // One discrete commit is a single undo step back to rx: 16.
    await act(async () => {
      undo()
    })
    expect(useStore.getState().document.nodes[rect.id].rx).toBe(16)
  })

  it('does not show the radius control for a non-rect (ellipse)', async () => {
    const ell = createEllipse({ cx: 100, cy: 100, rx: 50, ry: 30 })
    seed(ell)
    const { container } = render(<App />)
    // Give the panel a tick to render.
    await waitFor(() => expect(container.querySelector('input')).toBeTruthy())
    expect(radiusInput(container)).toBeFalsy()
  })
})
