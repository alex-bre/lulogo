import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { render, fireEvent, cleanup, act, waitFor } from '@testing-library/react'
import App from '../App'
import { useStore } from '../state/store'
import { createDocument } from '../model/document'
import { createImage, addNode } from '../model/nodes'

// jsdom lacks ResizeObserver and a canvas 2D context; stub both so App mounts.
beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  HTMLCanvasElement.prototype.getContext = () => null
})

afterEach(cleanup)

// A 1x1 transparent PNG — enough of an href for the <image> to render.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

describe('opacity slider works for images', () => {
  it('dragging opacity updates the image style and the rendered <image>', async () => {
    const doc = createDocument()
    const img = createImage({ x: 100, y: 100, width: 200, height: 150, href: PNG })
    addNode(doc, img)
    useStore.setState((s) => ({
      document: doc,
      selection: [img.id],
      past: [],
      future: [],
      ui: { ...s.ui, tool: 'select', rightTab: 'style', t3d: null, editingTextId: null, editingPathId: null },
    }))

    const { container } = render(<App />)

    // The opacity slider (the Style tab's only range input) starts at 1.
    let slider
    await waitFor(() => {
      slider = container.querySelector('input[type="range"]')
      expect(slider).toBeTruthy()
    })
    expect(slider.value).toBe('1')

    // Drag it to 0.5 → the image's style.opacity updates...
    await act(async () => {
      fireEvent.change(slider, { target: { value: '0.5' } })
    })
    expect(useStore.getState().document.nodes[img.id].style.opacity).toBe(0.5)

    // ...and the rendered <image> now carries that opacity (the bug: it didn't).
    await waitFor(() => {
      const el = container.querySelector(`image[data-id="${img.id}"]`)
      expect(el).toBeTruthy()
      expect(el.getAttribute('opacity')).toBe('0.5')
    })
  })
})
