import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import App from '../App'
import { useStore } from '../state/store'

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

// Width the panels are sized at, and the two collapse thresholds
// (state/useResponsiveLayout.js: left < 1000, right < 820).
const WIDE = 1400
const NARROW = 900 // left only
const TIGHT = 700 // both

function setWidth(w) {
  window.innerWidth = w
}

// Resize *after* mount, inside act() so the store update flushes.
function resizeTo(w) {
  act(() => {
    setWidth(w)
    window.dispatchEvent(new Event('resize'))
  })
}

const collapsed = () => {
  const { leftCollapsed, rightCollapsed } = useStore.getState().ui
  return { left: leftCollapsed, right: rightCollapsed }
}

beforeEach(() => {
  setWidth(WIDE)
  useStore.setState((s) => ({ ui: { ...s.ui, leftCollapsed: false, rightCollapsed: false } }))
})

afterEach(cleanup)

describe('responsive panel collapse', () => {
  it('collapses the tools panel, then both panels, as the viewport narrows', () => {
    render(<App />)
    expect(collapsed()).toEqual({ left: false, right: false })

    resizeTo(NARROW)
    expect(collapsed()).toEqual({ left: true, right: false })

    resizeTo(TIGHT)
    expect(collapsed()).toEqual({ left: true, right: true })
  })

  it('restores the panels it auto-collapsed when the viewport grows back', () => {
    render(<App />)
    resizeTo(TIGHT)
    expect(collapsed()).toEqual({ left: true, right: true })

    resizeTo(WIDE)
    expect(collapsed()).toEqual({ left: false, right: false })
  })

  it('collapses on mount when the viewport starts out narrow', () => {
    setWidth(TIGHT)
    render(<App />)
    expect(collapsed()).toEqual({ left: true, right: true })
  })

  it('leaves a panel the user re-opened on a narrow viewport alone', () => {
    setWidth(NARROW)
    render(<App />)
    expect(collapsed().left).toBe(true)

    // The user expands it by hand, then nudges the window (still narrow).
    act(() => useStore.getState().toggleLeftPanel())
    resizeTo(NARROW - 20)
    expect(collapsed().left).toBe(false)
  })

  it('does not re-open a panel the user collapsed themselves', () => {
    render(<App />)
    act(() => useStore.getState().toggleLeftPanel())
    expect(collapsed().left).toBe(true)

    // Crossing the threshold both ways must not undo a manual collapse.
    resizeTo(TIGHT)
    resizeTo(WIDE)
    expect(collapsed().left).toBe(true)
  })
})
