import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { render, fireEvent, cleanup, act, waitFor } from '@testing-library/react'
import App from '../App'
import { useStore } from '../state/store'
import { createDocument } from '../model/document'
import { createImage, addNode } from '../model/nodes'

beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  HTMLCanvasElement.prototype.getContext = () => null
})

afterEach(cleanup)

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

const axisSlider = (container, i) => container.querySelectorAll('input[type="range"]')[i]

describe('3D transform preview for images', () => {
  it('tilts a selected image via a matrix transform', async () => {
    const doc = createDocument()
    const img = createImage({ x: 100, y: 100, width: 220, height: 140, href: PNG })
    addNode(doc, img)
    useStore.setState((s) => ({
      document: doc,
      selection: [img.id],
      past: [],
      future: [],
      ui: { ...s.ui, tool: 'select', rightTab: 'arrange', t3d: null, editingTextId: null, editingPathId: null },
    }))

    const { container } = render(<App />)

    // Nudge Turn Y — the image is now part of the 3D session (no longer skipped).
    await act(async () => {
      fireEvent.change(axisSlider(container, 1), { target: { value: '45' } })
    })
    await waitFor(() => expect(useStore.getState().ui.t3d).toBeTruthy())
    expect(useStore.getState().ui.t3d.ids).toContain(img.id)

    // The preview draws the image with a matrix() transform (a tilt).
    await waitFor(() => {
      const el = container.querySelector('[data-t3d-image]')
      expect(el).toBeTruthy()
      expect(el.getAttribute('transform') || '').toMatch(/^matrix\(/)
    })
  })
})
