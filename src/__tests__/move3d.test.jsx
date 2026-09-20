import { describe, it, expect, afterEach } from 'vitest'
import { render, fireEvent, cleanup, act } from '@testing-library/react'
import Move3DSection from '../panels/right/tabs/Move3DSection'
import { move3DDelta } from '../model/projection3d'
import { useStore } from '../state/store'
import { createDocument } from '../model/document'
import { createRect, addNode } from '../model/nodes'

afterEach(cleanup)

describe('move3DDelta', () => {
  it('points straight into the screen (no on-screen move) at 0°/0°', () => {
    const [dx, dy] = move3DDelta(10, 0, 0)
    expect(dx).toBeCloseTo(0, 6)
    expect(dy).toBeCloseTo(0, 6)
  })

  it('turn about Y slides horizontally; tilt about X slides vertically', () => {
    expect(move3DDelta(10, 0, 90)[0]).toBeCloseTo(-10, 6) // full horizontal
    expect(move3DDelta(10, 0, 90)[1]).toBeCloseTo(0, 6)
    expect(move3DDelta(10, 90, 0)[1]).toBeCloseTo(-10, 6) // full vertical
    expect(move3DDelta(10, 90, 0)[0]).toBeCloseTo(0, 6)
  })

  it('foreshortens partial angles (30° → half of the distance)', () => {
    expect(move3DDelta(10, 0, 30)[0]).toBeCloseTo(-5, 6) // sin30 = 0.5
  })
})

describe('Move in 3D control', () => {
  it('translates the selection by the aimed 3D direction on Move', async () => {
    const doc = createDocument()
    const rect = createRect({ x: 100, y: 100, width: 50, height: 50 })
    addNode(doc, rect)
    useStore.setState({ document: doc, selection: [rect.id], past: [], future: [] })

    const { container } = render(<Move3DSection />)

    // Inputs (skipping the range sliders): [Distance, Tilt X, Turn Y].
    const nums = [...container.querySelectorAll('input')].filter((i) => i.type !== 'range')
    // Distance defaults to 10; aim fully sideways with Turn Y = 90 → dx = -10.
    await act(async () => {
      fireEvent.change(nums[2], { target: { value: '90' } })
      fireEvent.blur(nums[2])
    })

    await act(async () => {
      fireEvent.click(container.querySelector('button'))
    })

    const moved = useStore.getState().document.nodes[rect.id]
    expect(moved.x).toBeCloseTo(90, 3) // moved 10 units left in screen space
    expect(moved.y).toBeCloseTo(100, 3)
  })
})
