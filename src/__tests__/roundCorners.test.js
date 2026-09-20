import { describe, it, expect } from 'vitest'
import { roundPathData, roundNodeCorners, canRoundCorners, polygonPathData } from '../model/roundCorners'
import { parsePath } from '../model/pathEdit'
import { createRect, createPolygon, createPath, createEllipse } from '../model/nodes'

// Sample a `d` string densely and return its bounding box, so we can assert
// that rounding only ever cuts material away from the original outline.
function bboxOf(d) {
  const subs = parsePath(d)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const sp of subs) {
    for (const a of sp.anchors) {
      minX = Math.min(minX, a.x)
      minY = Math.min(minY, a.y)
      maxX = Math.max(maxX, a.x)
      maxY = Math.max(maxY, a.y)
    }
  }
  return { minX, minY, maxX, maxY }
}

const SQUARE = 'M 0 0 L 100 0 L 100 100 L 0 100 Z'

describe('roundPathData', () => {
  it('turns each square corner into a trimmed pair of anchors joined by a curve', () => {
    const d = roundPathData(SQUARE, 20)
    const subs = parsePath(d)
    expect(subs).toHaveLength(1)
    expect(subs[0].closed).toBe(true)
    // 4 corners → 8 anchors.
    expect(subs[0].anchors).toHaveLength(8)
    // The trim is exactly the radius on a 90° corner, so the straight run of
    // the top edge now goes from x=20 to x=80 at y=0.
    const top = subs[0].anchors.filter((a) => Math.abs(a.y) < 0.01).map((a) => a.x).sort((a, b) => a - b)
    expect(top[0]).toBeCloseTo(20, 2)
    expect(top[1]).toBeCloseTo(80, 2)
    // Fillet handles use the circular-arc constant (~0.5523 r).
    const corner = subs[0].anchors.find((a) => Math.abs(a.x - 20) < 0.01 && Math.abs(a.y) < 0.01)
    expect(corner.hIn.x).toBeCloseTo(20 - 0.5523 * 20, 1)
  })

  it('stays inside the original outline and keeps the untrimmed edges put', () => {
    const b = bboxOf(roundPathData(SQUARE, 30))
    expect(b.minX).toBeCloseTo(0, 3)
    expect(b.minY).toBeCloseTo(0, 3)
    expect(b.maxX).toBeCloseTo(100, 3)
    expect(b.maxY).toBeCloseTo(100, 3)
  })

  it('clamps an oversized radius to what the edges allow', () => {
    // r=200 on a 100px square: every corner wants a 200px trim but each edge
    // can only give 50px to each of its two corners.
    const subs = parsePath(roundPathData(SQUARE, 200))
    expect(subs[0].anchors).toHaveLength(8)
    for (const a of subs[0].anchors) {
      expect(a.x === 0 || a.x === 100 || Math.abs(a.x - 50) < 0.2).toBe(true)
    }
  })

  it('leaves the endpoints of an open path alone', () => {
    const d = roundPathData('M 0 0 L 100 0 L 100 100', 20)
    const subs = parsePath(d)
    expect(subs[0].closed).toBe(false)
    // start + rounded corner (2) + end
    expect(subs[0].anchors).toHaveLength(4)
    expect(subs[0].anchors[0]).toMatchObject({ x: 0, y: 0 })
    const end = subs[0].anchors[subs[0].anchors.length - 1]
    expect(end).toMatchObject({ x: 100, y: 100 })
  })

  it('rounds a sharp corner harder than a blunt one', () => {
    // Every corner gets radius 10, but the narrow apex of this triangle needs
    // a far longer trim along its edges to seat the same circle.
    const subs = parsePath(roundPathData('M 0 0 L 100 0 L 50 160 Z', 10))
    expect(subs[0].anchors).toHaveLength(6)
    const trimFrom = (cx, cy) =>
      subs[0].anchors
        .map((a) => Math.hypot(a.x - cx, a.y - cy))
        .sort((p, q) => p - q)
        .slice(0, 2)
    const [baseA, baseB] = trimFrom(0, 0)
    const [apexA, apexB] = trimFrom(50, 160)
    expect(baseA).toBeCloseTo(baseB, 1) // symmetric trim on both edges
    expect(apexA).toBeCloseTo(apexB, 1)
    expect(apexA).toBeGreaterThan(2 * baseA)
  })

  it('leaves an already-smooth outline untouched', () => {
    const circle =
      'M 50 0 C 77.6 0 100 22.4 100 50 C 100 77.6 77.6 100 50 100 C 22.4 100 0 77.6 0 50 C 0 22.4 22.4 0 50 0 Z'
    expect(roundPathData(circle, 10)).toBeNull()
  })

  it('rounds a corner between a line and a curve, staying tangent to both', () => {
    const d = roundPathData('M 0 0 L 100 0 C 100 60 60 100 0 100 Z', 15)
    expect(d).toBeTruthy()
    const subs = parsePath(d)
    // The corner at (100,0) is now two anchors: one on the straight top edge,
    // one on the curve — both pulled back from the original corner.
    const near = subs[0].anchors.filter((a) => Math.hypot(a.x - 100, a.y) < 40)
    expect(near.length).toBe(2)
    for (const a of near) expect(Math.hypot(a.x - 100, a.y)).toBeGreaterThan(1)
  })

  it('rounds every subpath of a compound path', () => {
    const d = roundPathData(`${SQUARE} M 200 0 L 300 0 L 300 100 L 200 100 Z`, 10)
    const subs = parsePath(d)
    expect(subs).toHaveLength(2)
    expect(subs[0].anchors).toHaveLength(8)
    expect(subs[1].anchors).toHaveLength(8)
  })

  it('is a no-op for a zero/negative radius or an empty path', () => {
    expect(roundPathData(SQUARE, 0)).toBeNull()
    expect(roundPathData(SQUARE, -5)).toBeNull()
    expect(roundPathData('', 10)).toBeNull()
  })
})

describe('roundNodeCorners', () => {
  it('gives a rect a live rx instead of baking a path', () => {
    const rect = createRect({ x: 0, y: 0, width: 100, height: 40 })
    const next = roundNodeCorners(rect, 12)
    expect(next.type).toBe('rect')
    expect(next.rx).toBe(12)
    expect(next.id).toBe(rect.id)
  })

  it('clamps a rect radius to half its shorter side', () => {
    expect(roundNodeCorners(createRect({ width: 100, height: 40 }), 50).rx).toBe(20)
  })

  it('converts a polygon into a rounded path, keeping id, style and transform', () => {
    const poly = createPolygon({ points: [[0, 0], [100, 0], [50, 80]], style: { fill: '#f0f' } })
    poly.rotation = 30
    const next = roundNodeCorners(poly, 10)
    expect(next.type).toBe('path')
    expect(next.id).toBe(poly.id)
    expect(next.rotation).toBe(30)
    expect(next.style.fill).toBe('#f0f')
    expect(next.points).toBeUndefined()
    expect(next.d).toContain('C')
  })

  it('rewrites a path node in place', () => {
    const p = createPath({ d: SQUARE })
    const next = roundNodeCorners(p, 10)
    expect(next.type).toBe('path')
    expect(next.d).not.toBe(SQUARE)
  })

  it('returns null when there is nothing to round', () => {
    expect(roundNodeCorners(createEllipse({}), 10)).toBeNull()
    expect(roundNodeCorners(createPath({ d: SQUARE }), 0)).toBeNull()
    const locked = createPath({ d: SQUARE })
    locked.locked = true
    expect(roundNodeCorners(locked, 10)).toBeNull()
  })

  it('reports which node types can be rounded', () => {
    expect(canRoundCorners(createRect({}))).toBe(true)
    expect(canRoundCorners(createPolygon({ points: [[0, 0], [1, 0], [1, 1]] }))).toBe(true)
    expect(canRoundCorners(createPath({ d: SQUARE }))).toBe(true)
    expect(canRoundCorners(createEllipse({}))).toBe(false)
    expect(canRoundCorners(null)).toBe(false)
  })

  it('builds path data from polygon points', () => {
    expect(polygonPathData([[0, 0], [10, 0], [10, 10]], true)).toBe('M 0 0 L 10 0 L 10 10 Z')
    expect(polygonPathData([[0, 0], [10, 0]], false)).toBe('M 0 0 L 10 0')
  })
})
