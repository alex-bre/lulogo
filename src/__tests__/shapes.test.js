import { describe, it, expect } from 'vitest'
import { createShapeOfKind, SHAPE_KINDS } from '../model/shapes'
import { geometryBBox } from '../model/bbox'

describe('shape library', () => {
  it('circle is an ellipse with equal radii (ellipse kept separately)', () => {
    const c = createShapeOfKind('circle', 100, 100)
    expect(c.type).toBe('ellipse')
    expect(c.rx).toBe(c.ry)
    const e = createShapeOfKind('ellipse', 100, 100)
    expect(e.type).toBe('ellipse')
    expect(e.rx).not.toBe(e.ry)
    expect(SHAPE_KINDS.map((s) => s.kind)).toEqual(expect.arrayContaining(['circle', 'ellipse']))
  })

  it('right triangle is a 3-point polygon', () => {
    const n = createShapeOfKind('right-triangle', 0, 0)
    expect(n.type).toBe('polygon')
    expect(n.points).toHaveLength(3)
  })

  it('half-circle, cube and cone are paths with data', () => {
    for (const k of ['half-circle', 'cube', 'cone']) {
      const n = createShapeOfKind(k, 0, 0)
      expect(n.type).toBe('path')
      expect(n.d).toMatch(/^M/)
    }
  })

  it('the cube has a stroke so its edges are visible', () => {
    expect(createShapeOfKind('cube', 0, 0).style.stroke).toBeTruthy()
  })

  it('places new shapes centered on the click point', () => {
    for (const k of ['circle', 'right-triangle', 'half-circle', 'cube', 'cone']) {
      const b = geometryBBox(createShapeOfKind(k, 50, 60))
      expect(b.x + b.width / 2).toBeCloseTo(50, 0)
      expect(b.y + b.height / 2).toBeCloseTo(60, 0)
    }
  })
})

describe('playing-card suits', () => {
  it('no longer offers the line shape', () => {
    expect(SHAPE_KINDS.map((s) => s.kind)).not.toContain('line')
  })

  it('offers all four suits', () => {
    expect(SHAPE_KINDS.map((s) => s.kind)).toEqual(
      expect.arrayContaining(['heart', 'diamond', 'spade', 'club']),
    )
  })

  it('heart, spade and club are paths with data', () => {
    for (const k of ['heart', 'spade', 'club']) {
      const n = createShapeOfKind(k, 0, 0)
      expect(n.type).toBe('path')
      expect(n.d).toMatch(/^M/)
    }
  })

  it('diamond is a 4-point polygon centered on the click point', () => {
    const n = createShapeOfKind('diamond', 50, 60)
    expect(n.type).toBe('polygon')
    expect(n.points).toHaveLength(4)
    const b = geometryBBox(n)
    expect(b.x + b.width / 2).toBeCloseTo(50, 0)
    expect(b.y + b.height / 2).toBeCloseTo(60, 0)
  })

  it('colors the red suits red and the black suits black', () => {
    expect(createShapeOfKind('heart', 0, 0).style.fill).toBe(createShapeOfKind('diamond', 0, 0).style.fill)
    expect(createShapeOfKind('spade', 0, 0).style.fill).toBe(createShapeOfKind('club', 0, 0).style.fill)
    expect(createShapeOfKind('heart', 0, 0).style.fill).not.toBe(createShapeOfKind('spade', 0, 0).style.fill)
  })
})
