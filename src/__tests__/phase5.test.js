import { describe, it, expect, beforeAll } from 'vitest'
import { useStore } from '../state/store'
import { createDocument } from '../model/document'
import { createRect, createEllipse, addNode } from '../model/nodes'
import { anchorsToPath } from '../model/pen'
import { flattenOrder, performBoolean } from '../geometry/boolean'

// jsdom has no canvas 2D context; Paper only needs it for rendering, not for the
// boolean path math. Stub a no-op context so paper.setup() succeeds in tests.
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = function () {
    return new Proxy(
      { canvas: this, measureText: () => ({ width: 0 }) },
      { get: (t, p) => (p in t ? t[p] : () => {}) },
    )
  }
})

describe('pen path generation', () => {
  it('builds a polyline path from corner anchors', () => {
    const d = anchorsToPath(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      true,
    )
    expect(d).toBe('M 0 0 L 10 0 L 10 10 L 0 0 Z')
  })

  it('builds cubic segments when handles are present', () => {
    const d = anchorsToPath(
      [
        { x: 0, y: 0, hOut: { x: 5, y: 0 } },
        { x: 10, y: 10, hIn: { x: 10, y: 5 } },
      ],
      false,
    )
    expect(d).toBe('M 0 0 C 5 0 10 5 10 10')
  })
})

describe('flattenOrder', () => {
  it('lists nodes in paint order, descending into groups', () => {
    const doc = createDocument()
    const a = createRect({ x: 0, y: 0, width: 1, height: 1 })
    addNode(doc, a)
    const order = flattenOrder(doc)
    expect(order).toContain(a.id)
  })
})

describe('boolean operations (Paper.js)', () => {
  it('unions two overlapping rectangles into one closed path', async () => {
    const doc = createDocument()
    const a = createRect({ x: 0, y: 0, width: 100, height: 100 })
    const b = createRect({ x: 50, y: 50, width: 100, height: 100 })
    addNode(doc, a)
    addNode(doc, b)

    const result = await performBoolean(doc, [a.id, b.id], 'union')
    expect(result).toBeTruthy()
    expect(result.d).toMatch(/^M/)
    expect(result.d.toLowerCase()).toContain('z') // closed
    expect(result.removeIds).toEqual([a.id, b.id])
    expect(result.baseId).toBe(a.id)
  })

  it('returns null when fewer than two booleanable shapes are selected', async () => {
    const doc = createDocument()
    const a = createRect({ x: 0, y: 0, width: 10, height: 10 })
    addNode(doc, a)
    expect(await performBoolean(doc, [a.id], 'union')).toBeNull()
  })

  it('applyBoolean replaces operands with the result path', async () => {
    const doc = createDocument()
    const a = createEllipse({ cx: 50, cy: 50, rx: 50, ry: 50 })
    const b = createEllipse({ cx: 90, cy: 50, rx: 50, ry: 50 })
    addNode(doc, a)
    addNode(doc, b)
    useStore.setState({ document: doc, selection: [a.id, b.id] })

    const result = await performBoolean(doc, [a.id, b.id], 'intersect')
    useStore.getState().applyBoolean(result)

    const st = useStore.getState()
    expect(st.document.nodes[a.id]).toBeUndefined()
    expect(st.document.nodes[b.id]).toBeUndefined()
    expect(st.selection).toHaveLength(1)
    expect(st.document.nodes[st.selection[0]].type).toBe('path')
  })
})
