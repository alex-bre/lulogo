import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { render, fireEvent, cleanup, act, waitFor } from '@testing-library/react'
import App from '../App'
import { useStore } from '../state/store'
import { createDocument } from '../model/document'
import { createRect, addNode } from '../model/nodes'

beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  HTMLCanvasElement.prototype.getContext = () => null
})

afterEach(cleanup)

const axisSlider = (container, i) => container.querySelectorAll('input[type="range"]')[i]

describe('3D thickness preview', () => {
  it('renders an extruded solid (front cap + shaded walls) on the canvas', async () => {
    const doc = createDocument()
    const rect = createRect({ x: 100, y: 100, width: 220, height: 140, style: { fill: '#4080c0' } })
    addNode(doc, rect)
    useStore.setState((s) => ({
      document: doc,
      selection: [rect.id],
      past: [],
      future: [],
      ui: { ...s.ui, tool: 'select', rightTab: 'arrange', t3d: null, editingTextId: null, editingPathId: null },
    }))

    const { container } = render(<App />)

    // Nudge Turn Y to start a preview session, then dial in thickness.
    await act(async () => {
      fireEvent.change(axisSlider(container, 1), { target: { value: '35' } })
    })
    await waitFor(() => expect(useStore.getState().ui.t3d).toBeTruthy())
    await act(async () => {
      useStore.getState().setT3DParams({ rx: 28, depth: 40 })
    })

    // The preview now draws extruded faces: a front cap plus shaded side walls.
    let faces
    await waitFor(() => {
      faces = [...container.querySelectorAll('[data-t3d-face]')]
      expect(faces.length).toBeGreaterThanOrEqual(3)
    })
    expect(faces.some((f) => f.getAttribute('data-t3d-face') === 'front')).toBe(true)
    const sides = faces.filter((f) => f.getAttribute('data-t3d-face') === 'side')
    expect(sides.length).toBeGreaterThanOrEqual(2)
    // Side walls carry a shaded hex fill that isn't the original blue.
    for (const s of sides) {
      const fill = s.getAttribute('fill')
      expect(fill).toMatch(/^#[0-9a-f]{6}$/i)
      expect(fill.toLowerCase()).not.toBe('#4080c0')
    }
  })
})
