import { describe, it, expect } from 'vitest'
import { collectSnapLines, snapBox, snapPoint, guidesFor } from '../model/objectSnap'

// A single target rect at (100,100) 50x50 → edges/centers at x∈{100,125,150},
// y∈{100,125,150}.
const target = { x: 100, y: 100, width: 50, height: 50 }
const lines = collectSnapLines([target])

describe('collectSnapLines', () => {
  it('emits left/center/right and top/middle/bottom candidates per box', () => {
    expect(lines.vert.map((l) => l.pos).sort((a, b) => a - b)).toEqual([100, 125, 150])
    expect(lines.horz.map((l) => l.pos).sort((a, b) => a - b)).toEqual([100, 125, 150])
    // Each vertical line carries the box's y-extent for guide drawing.
    expect(lines.vert[0]).toMatchObject({ min: 100, max: 150 })
  })
})

describe('snapBox', () => {
  it('snaps a left edge onto a target left edge within tolerance', () => {
    const box = { x: 103, y: 300, width: 10, height: 10 } // left edge 3px from x=100
    const s = snapBox(box, lines, 6)
    expect(s.x).toBe(100)
    expect(s.vLine.pos).toBe(100)
  })

  it('snaps a right edge onto a target right edge', () => {
    const box = { x: 128, y: 300, width: 20, height: 20 } // right edge 148 → x=150
    const s = snapBox(box, lines, 6)
    expect(s.x + box.width).toBe(150)
  })

  it('leaves the box untouched when nothing is within tolerance', () => {
    const box = { x: 300, y: 300, width: 20, height: 20 }
    const s = snapBox(box, lines, 6)
    expect(s.x).toBe(300)
    expect(s.vLine).toBeNull()
    expect(s.hLine).toBeNull()
  })

  it('prefers the nearest candidate on each axis independently', () => {
    // center at x=124 → snaps to center line 125 (1px) not left 100 (24px).
    const box = { x: 114, y: 300, width: 20, height: 20 }
    const s = snapBox(box, lines, 6)
    expect(s.x + box.width / 2).toBe(125)
  })
})

describe('snapPoint', () => {
  it('snaps only on the requested axes', () => {
    const s = snapPoint({ x: 102, y: 102 }, lines, 6, true, false)
    expect(s.x).toBe(100)
    expect(s.y).toBe(102) // y axis not requested
    expect(s.hLine).toBeNull()
  })
})

describe('guidesFor', () => {
  it('builds a vertical guide spanning both boxes', () => {
    const box = { x: 100, y: 300, width: 20, height: 20 }
    const g = guidesFor(box, lines.vert[0], null)
    expect(g).toHaveLength(1)
    expect(g[0]).toMatchObject({ o: 'v', pos: 100, min: 100, max: 320 })
  })

  it('returns nothing when no lines matched', () => {
    expect(guidesFor({ x: 0, y: 0, width: 1, height: 1 }, null, null)).toEqual([])
  })
})
