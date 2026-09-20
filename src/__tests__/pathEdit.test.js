import { describe, it, expect } from 'vitest'
import { parsePath, serializeSubpaths, insertAnchor, deleteAnchor, cubicPoint } from '../model/pathEdit'

describe('pathEdit', () => {
  it('parses a simple open polyline into anchors', () => {
    const subs = parsePath('M 0 0 L 10 0 L 10 10')
    expect(subs).toHaveLength(1)
    expect(subs[0].closed).toBe(false)
    expect(subs[0].anchors.map((a) => [a.x, a.y])).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
    ])
    expect(subs[0].anchors.every((a) => !a.hIn && !a.hOut)).toBe(true)
  })

  it('parses a cubic segment into handles on the two anchors', () => {
    const subs = parsePath('M 0 0 C 0 5 10 5 10 0')
    const [a0, a1] = subs[0].anchors
    expect(a0.hOut).toEqual({ x: 0, y: 5 })
    expect(a1.hIn).toEqual({ x: 10, y: 5 })
  })

  it('round-trips a closed cubic path (folding the duplicate close anchor)', () => {
    const d = 'M 0 0 C 5 0 10 5 10 10 C 5 10 0 5 0 0 Z'
    const subs = parsePath(d)
    expect(subs[0].closed).toBe(true)
    expect(subs[0].anchors).toHaveLength(2)
    expect(serializeSubpaths(subs)).toBe(d)
  })

  it('handles multiple subpaths', () => {
    const subs = parsePath('M 0 0 L 10 0 Z M 20 20 L 30 20 L 30 30 Z')
    expect(subs).toHaveLength(2)
    expect(subs[0].anchors).toHaveLength(2)
    expect(subs[1].anchors).toHaveLength(3)
  })

  it('inserts a point on a line segment at the projected position', () => {
    const subs = parsePath('M 0 0 L 10 0')
    const { subs: next, ai } = insertAnchor(subs, 0, 0, { x: 4, y: 3 })
    expect(ai).toBe(1)
    expect(next[0].anchors).toHaveLength(3)
    expect(next[0].anchors[1].x).toBeCloseTo(4)
    expect(next[0].anchors[1].y).toBeCloseTo(0)
  })

  it('splitting a cubic preserves the curve shape', () => {
    const subs = parsePath('M 0 0 C 0 10 10 10 10 0')
    const before = cubicPoint(
      subs[0].anchors[0],
      subs[0].anchors[0].hOut,
      subs[0].anchors[1].hIn,
      subs[0].anchors[1],
      0.5,
    )
    const { subs: next } = insertAnchor(subs, 0, 0, { t: 0.5 })
    const [p0, mid, p1] = next[0].anchors
    // The new mid anchor sits exactly on the original curve at t=0.5.
    expect(mid.x).toBeCloseTo(before.x)
    expect(mid.y).toBeCloseTo(before.y)
    // Each half still starts/ends at the original endpoints.
    expect([p0.x, p0.y]).toEqual([0, 0])
    expect([p1.x, p1.y]).toEqual([10, 0])
  })

  it('deletes a point, and drops a subpath that becomes too small', () => {
    const two = parsePath('M 0 0 L 10 0 L 20 0')
    expect(deleteAnchor(two, 0, 1)[0].anchors).toHaveLength(2)
    const oneLeft = deleteAnchor(parsePath('M 0 0 L 10 0'), 0, 0)
    expect(oneLeft).toHaveLength(0)
  })
})
