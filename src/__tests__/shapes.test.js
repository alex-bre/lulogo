import { describe, it, expect, beforeAll } from 'vitest'
import { createShapeOfKind, SHAPE_GROUPS, SHAPE_KINDS } from '../model/shapes'
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

describe('shape groups', () => {
  it('puts every kind in a known group, Basic first', () => {
    expect(SHAPE_GROUPS[0].id).toBe('basic')
    const ids = SHAPE_GROUPS.map((g) => g.id)
    for (const s of SHAPE_KINDS) expect(ids).toContain(s.group)
  })
})

describe('added basic shapes and stars', () => {
  // jsdom has no canvas 2D context; Paper only needs one to set up, not for path math.
  beforeAll(() => {
    HTMLCanvasElement.prototype.getContext = function () {
      return new Proxy(
        { canvas: this, measureText: () => ({ width: 0 }) },
        { get: (t, p) => (p in t ? t[p] : () => {}) },
      )
    }
  })

  const box = (kind) => geometryBBox(createShapeOfKind(kind, 100, 100))

  it('square is an equal-sided rect', () => {
    const n = createShapeOfKind('square', 100, 100)
    expect(n.type).toBe('rect')
    expect(n.width).toBe(n.height)
  })

  it('pill is a rect with fully rounded ends', () => {
    const n = createShapeOfKind('pill', 100, 100)
    expect(n.type).toBe('rect')
    expect(n.rx).toBe(n.height / 2)
    expect(n.width).toBeGreaterThan(n.height)
  })

  it('ring is a two-circle path with the hole wound the other way', async () => {
    const n = createShapeOfKind('ring', 100, 100)
    expect(n.type).toBe('path')
    expect(n.d.match(/M/g)).toHaveLength(2)
    const { getPaper, nodeToPaperPath } = await import('../geometry/paperBridge')
    const paper = await getPaper()
    const p = nodeToPaperPath(paper, n)
    // The filled area is the annulus, not the full disc.
    expect(Math.abs(p.area)).toBeCloseTo(Math.PI * (80 ** 2 - 48 ** 2), -2)
    expect(p.contains(new paper.Point(100, 100))).toBe(false)
    expect(p.contains(new paper.Point(164, 100))).toBe(true)
  })

  it('quarter-circle has a square bounding box', () => {
    const b = box('quarter-circle')
    expect(b.width).toBeCloseTo(b.height, 1)
  })

  it('4- and 6-point stars have 8 and 12 vertices', () => {
    expect(createShapeOfKind('star-4', 0, 0).points).toHaveLength(8)
    expect(createShapeOfKind('star-6', 0, 0).points).toHaveLength(12)
  })

  it('every new shape is centered on the click point', () => {
    for (const k of ['square', 'pill', 'ring', 'quarter-circle', 'star-4', 'star-6']) {
      const b = box(k)
      expect(b.x + b.width / 2).toBeCloseTo(100, 0)
      expect(b.y + b.height / 2).toBeCloseTo(100, 0)
    }
  })
})
