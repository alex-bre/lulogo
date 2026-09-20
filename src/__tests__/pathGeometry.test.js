import { describe, it, expect } from 'vitest'
import { transformPathData } from '../model/pathTransform'
import { geometryBBox } from '../model/bbox'
import { translateNode, scaleNode } from '../model/mutate'
import { createPath } from '../model/nodes'

describe('transformPathData', () => {
  it('translates absolute M/L/Z paths', () => {
    expect(transformPathData('M 0 0 L 10 0 L 10 10 Z', [1, 0, 0, 1, 5, 5])).toBe('M 5 5 L 15 5 L 15 15 Z')
  })
  it('scales about the origin', () => {
    expect(transformPathData('M 0 0 L 10 0 L 10 10 Z', [2, 0, 0, 2, 0, 0])).toBe('M 0 0 L 20 0 L 20 20 Z')
  })
  it('transforms cubic control points', () => {
    expect(transformPathData('M 0 0 C 0 5 5 10 10 10', [1, 0, 0, 1, 1, 2])).toBe('M 1 2 C 1 7 6 12 11 12')
  })
  it('normalizes H/V to absolute L', () => {
    expect(transformPathData('M 0 0 H 10 V 10', [1, 0, 0, 1, 0, 0])).toBe('M 0 0 L 10 0 L 10 10')
  })
  it('handles relative commands', () => {
    expect(transformPathData('M 1 1 l 4 0 l 0 4 z', [1, 0, 0, 1, 0, 0])).toBe('M 1 1 L 5 1 L 5 5 Z')
  })
})

describe('path node bbox and mutations', () => {
  it('computes a path bounding box', () => {
    const b = geometryBBox(createPath({ d: 'M 10 20 L 40 20 L 40 60 Z' }))
    expect(b).toEqual({ x: 10, y: 20, width: 30, height: 40 })
  })
  it('translates a path node', () => {
    const n = createPath({ d: 'M 0 0 L 10 0' })
    translateNode(n, 5, 7, {})
    expect(n.d).toBe('M 5 7 L 15 7')
  })
  it('scales a path node about an anchor', () => {
    const n = createPath({ d: 'M 2 2 L 12 2' })
    scaleNode(n, 2, 2, 2, 1, {})
    expect(n.d).toBe('M 2 2 L 22 2')
  })
})
