import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { render, fireEvent, cleanup, act, waitFor } from '@testing-library/react'
import App from '../App'
import { useStore } from '../state/store'
import { createDocument } from '../model/document'
import { createRect, addNode } from '../model/nodes'
import { faceViewParams, rotationMatrix } from '../model/projection3d'

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

// Seed a one-rect document with the rect selected and the Arrange tab open.
function seed() {
  const doc = createDocument()
  const rect = createRect({ x: 100, y: 100, width: 200, height: 100 })
  addNode(doc, rect)
  useStore.setState((s) => ({
    document: doc,
    selection: [rect.id],
    past: [],
    future: [],
    ui: { ...s.ui, tool: 'select', rightTab: 'arrange', t3d: null, editingTextId: null, editingPathId: null },
  }))
  return rect
}

// The three sliders in the Arrange tab belong to the 3D section (Tilt X,
// Turn Y, Spin Z — orthographic mode shows no Strength slider).
const axisSlider = (container, i) => container.querySelectorAll('input[type="range"]')[i]

describe('3D transform end-to-end', () => {
  it('slider → live preview (cube + dimmed original) → orbit drag → Enter applies', async () => {
    const rect = seed()
    const { container } = render(<App />)

    // Nudging the Turn Y slider starts a preview session.
    await act(async () => {
      fireEvent.change(axisSlider(container, 1), { target: { value: '60' } })
    })
    await waitFor(() => expect(useStore.getState().ui.t3d).toBeTruthy())
    expect(useStore.getState().ui.t3d.params.ry).toBe(60)

    // The canvas shows the orbit cube, the projected shape, and dims the original.
    const hull = container.querySelector('[data-t3d]')
    expect(hull).toBeTruthy()
    expect(container.querySelector('g[opacity="0.15"]')).toBeTruthy()

    // Dragging the cube 40px right turns Y further (0.35°/px → +14°).
    await act(async () => {
      hull.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 100, clientY: 100 }))
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 140, clientY: 100 }))
      window.dispatchEvent(new MouseEvent('pointerup', {}))
    })
    expect(useStore.getState().ui.t3d.params.ry).toBeCloseTo(74, 5)

    // Enter bakes the projection: the rect becomes a path, preview ends.
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    const st = useStore.getState()
    expect(st.ui.t3d).toBeNull()
    expect(st.document.nodes[rect.id].type).toBe('path')
    expect(container.querySelector('[data-t3d]')).toBeNull()
    // One history entry — a single undo restores the rect.
    expect(st.past.length).toBe(1)
  })

  it('clicking a side face reseats the artwork onto that plane (facing the viewer)', async () => {
    seed()
    const { container } = render(<App />)

    // Start a session and orbit to an iso 3/4 view so side faces are exposed.
    await act(async () => {
      fireEvent.change(axisSlider(container, 1), { target: { value: '45' } })
    })
    await waitFor(() => expect(useStore.getState().ui.t3d).toBeTruthy())
    await act(async () => {
      useStore.getState().setT3DParams({ rx: 35.2644, ry: 45, rz: 0 })
    })

    // A clickable hit-target exists for each visible side face.
    let face
    await waitFor(() => {
      face = container.querySelector('[data-t3d="face"]')
      expect(face).toBeTruthy()
    })
    const faceIndex = parseInt(face.getAttribute('data-face'), 10)
    const before = { ...useStore.getState().ui.t3d.params }

    // A press-and-release with no drag snaps; params match faceViewParams.
    await act(async () => {
      face.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 100, clientY: 100 }))
      window.dispatchEvent(new MouseEvent('pointerup', {}))
    })
    const after = useStore.getState().ui.t3d.params
    const expected = faceViewParams(faceIndex, before)
    expect(after.rx).toBeCloseTo(expected.rx, 5)
    expect(after.ry).toBeCloseTo(expected.ry, 5)
    expect(after.rz).toBeCloseTo(expected.rz, 5)

    // The reseated artwork now faces the viewer: the front normal [0,0,-1]
    // rotated by the new orientation has z < 0 (toward the camera).
    const m = rotationMatrix(after.rx, after.ry, after.rz)
    expect(-m[8]).toBeLessThan(0)
  })

  it('dragging a side face still orbits (does not snap)', async () => {
    seed()
    const { container } = render(<App />)

    await act(async () => {
      fireEvent.change(axisSlider(container, 1), { target: { value: '45' } })
    })
    await waitFor(() => expect(useStore.getState().ui.t3d).toBeTruthy())
    await act(async () => {
      useStore.getState().setT3DParams({ rx: 35.2644, ry: 45, rz: 0 })
    })

    let face
    await waitFor(() => {
      face = container.querySelector('[data-t3d="face"]')
      expect(face).toBeTruthy()
    })

    // Drag 40px right → orbits Y by +14° (0.35°/px), same as the silhouette.
    await act(async () => {
      face.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 100, clientY: 100 }))
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 140, clientY: 100 }))
      window.dispatchEvent(new MouseEvent('pointerup', {}))
    })
    expect(useStore.getState().ui.t3d.params.ry).toBeCloseTo(59, 5)
    expect(useStore.getState().ui.t3d.params.rx).toBeCloseTo(35.2644, 4)
  })

  it('Escape cancels the preview without touching the document', async () => {
    const rect = seed()
    const { container } = render(<App />)
    const before = useStore.getState().document

    await act(async () => {
      fireEvent.change(axisSlider(container, 0), { target: { value: '-30' } })
    })
    await waitFor(() => expect(useStore.getState().ui.t3d).toBeTruthy())

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    const st = useStore.getState()
    expect(st.ui.t3d).toBeNull()
    expect(st.document).toBe(before)
    expect(st.document.nodes[rect.id].type).toBe('rect')
  })

  it('changing the selection ends the session', async () => {
    seed()
    const { container } = render(<App />)

    await act(async () => {
      fireEvent.change(axisSlider(container, 2), { target: { value: '45' } })
    })
    await waitFor(() => expect(useStore.getState().ui.t3d).toBeTruthy())

    await act(async () => {
      useStore.getState().clearSelection()
    })
    await waitFor(() => expect(useStore.getState().ui.t3d).toBeNull())
  })
})
