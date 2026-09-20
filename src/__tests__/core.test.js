import { describe, it, expect, beforeEach } from 'vitest'
import { clampZoom, screenToWorld, worldToScreen, computeFit } from '../canvas/viewport'
import { nodeTransform } from '../model/transform'
import { styleAttrs } from '../model/style'
import { geometryBBox, unionBBox } from '../model/bbox'
import { createRect, createEllipse } from '../model/nodes'
import { useStore } from '../state/store'

describe('viewport math', () => {
  it('clamps zoom to range', () => {
    expect(clampZoom(1000)).toBeLessThanOrEqual(64)
    expect(clampZoom(0)).toBeGreaterThan(0)
    expect(clampZoom(2)).toBe(2)
  })

  it('round-trips screen <-> world', () => {
    const vp = { panX: 120, panY: -40, zoom: 2.5 }
    const w = screenToWorld(300, 200, vp)
    const s = worldToScreen(w.x, w.y, vp)
    expect(s.x).toBeCloseTo(300)
    expect(s.y).toBeCloseTo(200)
  })

  it('fits a page centered in the viewport', () => {
    const f = computeFit(1000, 1000, 500, 500, 1)
    expect(f.zoom).toBe(2)
    expect(f.panX).toBe(0)
    expect(f.panY).toBe(0)
  })
})

describe('store.zoomAt keeps the cursor point fixed', () => {
  beforeEach(() => useStore.getState().setViewport({ panX: 100, panY: 50, zoom: 2 }))

  it('preserves the world point under the cursor', () => {
    const before = screenToWorld(300, 200, useStore.getState().viewport)
    useStore.getState().zoomAt(300, 200, 1.5)
    const vp = useStore.getState().viewport
    expect(vp.zoom).toBe(3)
    const after = screenToWorld(300, 200, vp)
    expect(after.x).toBeCloseTo(before.x)
    expect(after.y).toBeCloseTo(before.y)
  })
})

describe('nodeTransform', () => {
  it('is undefined for an upright, un-flipped node', () => {
    expect(nodeTransform(createRect({ x: 0, y: 0, width: 10, height: 10 }))).toBeUndefined()
  })

  it('rotates about the geometry center', () => {
    const t = nodeTransform(createRect({ x: 0, y: 0, width: 100, height: 100, rotation: 45 }))
    expect(t).toBe('rotate(45 50 50)')
  })

  it('emits a centered flip', () => {
    const t = nodeTransform(createRect({ x: 0, y: 0, width: 100, height: 40, flipX: true }))
    expect(t).toBe('translate(50 20) scale(-1 1) translate(-50 -20)')
  })
})

describe('styleAttrs omits SVG defaults', () => {
  it('keeps explicit fill, drops default stroke width and full opacity', () => {
    const a = styleAttrs({ fill: '#abc', strokeWidth: 1, opacity: 1, fillOpacity: 1 })
    expect(a.fill).toBe('#abc')
    expect(a.strokeWidth).toBeUndefined()
    expect(a.opacity).toBeUndefined()
    expect(a.fillOpacity).toBeUndefined()
  })

  it('maps null fill to none and keeps a real stroke', () => {
    const a = styleAttrs({ fill: null, stroke: '#000', strokeWidth: 3 })
    expect(a.fill).toBe('none')
    expect(a.stroke).toBe('#000')
    expect(a.strokeWidth).toBe(3)
  })
})

describe('bbox', () => {
  it('computes rect and ellipse bounds', () => {
    expect(geometryBBox(createRect({ x: 10, y: 20, width: 30, height: 40 }))).toEqual({
      x: 10,
      y: 20,
      width: 30,
      height: 40,
    })
    expect(geometryBBox(createEllipse({ cx: 100, cy: 100, rx: 25, ry: 10 }))).toEqual({
      x: 75,
      y: 90,
      width: 50,
      height: 20,
    })
  })

  it('unions bounds', () => {
    const u = unionBBox([
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 20, y: 5, width: 10, height: 10 },
    ])
    expect(u).toEqual({ x: 0, y: 0, width: 30, height: 15 })
  })
})
