import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { useStore, THEME_KEY, systemTheme } from '../state/store'
import { initThemePersist } from '../state/persist'
import { useThemeEffect } from '../state/useTheme'

// jsdom has no matchMedia, so stand one up: `dark` decides what the OS reports,
// and `fire()` plays an OS-level switch while the app is open.
function stubMatchMedia(dark) {
  const listeners = new Set()
  const mql = {
    matches: dark,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_, fn) => listeners.add(fn),
    removeEventListener: (_, fn) => listeners.delete(fn),
  }
  window.matchMedia = vi.fn(() => mql)
  return {
    fire(nowDark) {
      mql.matches = nowDark
      act(() => listeners.forEach((fn) => fn(mql)))
    },
    listenerCount: () => listeners.size,
  }
}

function Harness() {
  useThemeEffect()
  return null
}

beforeEach(() => {
  localStorage.removeItem(THEME_KEY)
  useStore.setState((s) => ({ ui: { ...s.ui, theme: 'light', themePref: 'system' } }))
})

afterEach(() => {
  cleanup()
  delete window.matchMedia
  localStorage.removeItem(THEME_KEY)
})

describe('system theme detection', () => {
  it('reports the OS preference, and light when it cannot be read', () => {
    stubMatchMedia(true)
    expect(systemTheme()).toBe('dark')
    stubMatchMedia(false)
    expect(systemTheme()).toBe('light')
    delete window.matchMedia
    expect(systemTheme()).toBe('light')
  })
})

describe('theme follows the system until a choice is made', () => {
  it('applies the OS preference on mount', () => {
    stubMatchMedia(true)
    render(<Harness />)

    expect(useStore.getState().ui.theme).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('tracks an OS switch while the editor is open', () => {
    const os = stubMatchMedia(false)
    render(<Harness />)
    expect(useStore.getState().ui.theme).toBe('light')

    os.fire(true)
    expect(useStore.getState().ui.theme).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('stops tracking the OS once the user picks a side', () => {
    const os = stubMatchMedia(false)
    render(<Harness />)

    act(() => useStore.getState().toggleTheme()) // explicit dark
    expect(useStore.getState().ui.themePref).toBe('dark')

    os.fire(false) // OS says light — the explicit choice wins
    expect(useStore.getState().ui.theme).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it("resumes following the OS when the choice is cleared to 'system'", () => {
    const os = stubMatchMedia(true)
    render(<Harness />)

    act(() => useStore.getState().setTheme('light'))
    expect(useStore.getState().ui.theme).toBe('light')

    act(() => useStore.getState().setTheme('system'))
    expect(useStore.getState().ui.theme).toBe('dark') // back on the OS setting
    os.fire(false)
    expect(useStore.getState().ui.theme).toBe('light')
  })

  it('drops its listener on unmount', () => {
    const os = stubMatchMedia(false)
    const { unmount } = render(<Harness />)
    expect(os.listenerCount()).toBe(1)
    unmount()
    expect(os.listenerCount()).toBe(0)
  })
})

describe('an explicit choice is remembered', () => {
  it('stores light/dark and clears the key for system', () => {
    stubMatchMedia(false)
    initThemePersist()

    act(() => useStore.getState().setTheme('dark'))
    expect(localStorage.getItem(THEME_KEY)).toBe('dark')

    act(() => useStore.getState().setTheme('system'))
    expect(localStorage.getItem(THEME_KEY)).toBeNull()
  })
})
