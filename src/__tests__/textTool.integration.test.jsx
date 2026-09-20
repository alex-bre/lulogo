import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import App from '../App'
import { useStore } from '../state/store'
import { createDocument } from '../model/document'

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

describe('text tool end-to-end', () => {
  it('adds a text node when the tool is active and the canvas is clicked', () => {
    useStore.setState((s) => ({
      document: createDocument(),
      selection: [],
      ui: { ...s.ui, tool: 'select', editingTextId: null },
    }))

    const { container } = render(<App />)

    // Activate the text tool from the left panel.
    fireEvent.click(screen.getByText('Text tool'))
    expect(useStore.getState().ui.tool).toBe('text')

    // Click on the canvas (direct child of <main>, not a lucide icon svg).
    const svg = container.querySelector('main > svg')
    act(() => {
      svg.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 200, clientY: 200 }))
    })

    const st = useStore.getState()
    const textNodes = Object.values(st.document.nodes).filter((n) => n.type === 'text')
    expect(textNodes).toHaveLength(1)
    expect(textNodes[0].text).toBe('Text')
    expect(st.ui.editingTextId).toBe(textNodes[0].id)
  })
})
