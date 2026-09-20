import { describe, it, expect } from 'vitest'
import { createDocument } from '../model/document'
import { createRect, createEllipse, createPolygon, createLine, createGroup, addNode } from '../model/nodes'
import { serializeDocument } from '../io/serialize'
import { snapValue, rectsIntersect } from '../model/snap'
import { translateNode, cloneSubtree } from '../model/mutate'

describe('serializeDocument — clean SVG', () => {
  it('emits an SVG header with viewBox and page size', () => {
    const svg = serializeDocument(createDocument())
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1754" width="1200" height="1754">')
  })

  it('omits default attributes (no stroke / opacity on a plain fill)', () => {
    const doc = createDocument()
    addNode(doc, createRect({ x: 10, y: 20, width: 30, height: 40 }))
    const svg = serializeDocument(doc)
    expect(svg).toMatch(/<rect x="10" y="20" width="30" height="40" fill="#9aa6b2"\/>/)
    expect(svg).not.toContain('stroke')
    expect(svg).not.toContain('opacity')
    expect(svg).not.toContain('rx')
  })

  it('emits a transform only for rotation/flip', () => {
    const doc = createDocument()
    addNode(doc, createRect({ x: 0, y: 0, width: 100, height: 100, rotation: 90 }))
    expect(serializeDocument(doc)).toContain('transform="rotate(90 50 50)"')
  })

  it('serializes polygons and lines', () => {
    const doc = createDocument()
    addNode(doc, createPolygon({ points: [[0, 0], [10, 0], [10, 10]] }))
    addNode(doc, createLine({ x1: 0, y1: 0, x2: 10, y2: 10 }))
    const svg = serializeDocument(doc)
    expect(svg).toContain('<polygon points="0,0 10,0 10,10" fill="#9aa6b2"/>')
    expect(svg).toContain('<line x1="0" y1="0" x2="10" y2="10" fill="none" stroke="#1a1d21" stroke-width="2"/>')
  })

  it('excludes hidden nodes', () => {
    const doc = createDocument()
    const r = createRect({ x: 0, y: 0, width: 10, height: 10 })
    r.hidden = true
    addNode(doc, r)
    expect(serializeDocument(doc)).not.toContain('<rect')
  })

  it('emits a background rect only when set', () => {
    const doc = createDocument()
    expect(serializeDocument(doc)).not.toContain('width="1200" height="1754" fill=')
    doc.background = '#ff0000'
    expect(serializeDocument(doc)).toContain('<rect width="1200" height="1754" fill="#ff0000"/>')
  })

  it('flattens transparent groups but keeps groups with attributes', () => {
    const doc = createDocument()
    const g = createGroup({ name: 'Background' })
    addNode(doc, g)
    addNode(doc, createRect({ x: 0, y: 0, width: 5, height: 5 }), g.id)

    let svg = serializeDocument(doc)
    expect(svg).not.toContain('<g>') // transparent group is flattened away
    expect(svg).toContain('<rect x="0" y="0" width="5" height="5"')

    g.style = { opacity: 0.5 } // now it carries a real attribute
    svg = serializeDocument(doc)
    expect(svg).toContain('<g opacity="0.5">')
    expect(svg).toContain('</g>')
  })
})

describe('snapping', () => {
  it('snaps to the grid size when enabled', () => {
    expect(snapValue(13, { enabled: true }, { size: 10 })).toBe(10)
    expect(snapValue(16, { enabled: true }, { size: 10 })).toBe(20)
  })
  it('leaves the value untouched when disabled', () => {
    expect(snapValue(13.4, { enabled: false }, { size: 10 })).toBe(13.4)
  })
  it('detects rectangle overlap', () => {
    expect(rectsIntersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 })).toBe(true)
    expect(rectsIntersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: 0, width: 5, height: 5 })).toBe(false)
  })
})

describe('mutations', () => {
  it('translates each geometry type', () => {
    const rect = createRect({ x: 1, y: 2, width: 3, height: 4 })
    translateNode(rect, 10, 20, {})
    expect([rect.x, rect.y]).toEqual([11, 22])

    const poly = createPolygon({ points: [[0, 0], [2, 2]] })
    translateNode(poly, 5, 5, {})
    expect(poly.points).toEqual([[5, 5], [7, 7]])

    const line = createLine({ x1: 0, y1: 0, x2: 4, y2: 4 })
    translateNode(line, 1, 1, {})
    expect([line.x1, line.y1, line.x2, line.y2]).toEqual([1, 1, 5, 5])
  })

  it('translates group descendants', () => {
    const nodes = {}
    const rect = createRect({ x: 0, y: 0, width: 1, height: 1 })
    nodes[rect.id] = rect
    const group = createGroup({ children: [rect.id] })
    nodes[group.id] = group
    translateNode(group, 5, 0, nodes)
    expect(rect.x).toBe(5)
  })

  it('clones a subtree with fresh ids', () => {
    const nodes = {}
    const rect = createRect({ x: 0, y: 0, width: 1, height: 1 })
    nodes[rect.id] = rect
    const copy = cloneSubtree(rect, nodes, nodes)
    expect(copy.id).not.toBe(rect.id)
    expect(nodes[copy.id]).toBe(copy)
    copy.x = 99
    expect(rect.x).toBe(0) // independent
  })
})
