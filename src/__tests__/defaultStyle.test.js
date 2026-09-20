import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../state/store'
import { createDocument, defaultStyleOf } from '../model/document'
import { createShapeOfKind } from '../model/shapes'
import { DEFAULT_STYLE } from '../model/nodes'

// The document-wide default style (General tab) and how newly drawn objects
// pick it up.

const newest = () => {
  const doc = useStore.getState().document
  return doc.nodes[doc.rootOrder[doc.rootOrder.length - 1]]
}

beforeEach(() => {
  useStore.setState({ document: createDocument(), selection: [], past: [], future: [] })
})

describe('document default style', () => {
  it('starts from the factory style and survives a legacy document', () => {
    expect(createDocument().defaultStyle).toEqual({
      fill: DEFAULT_STYLE.fill,
      stroke: DEFAULT_STYLE.stroke,
      strokeWidth: DEFAULT_STYLE.strokeWidth,
      opacity: DEFAULT_STYLE.opacity,
    })
    // Documents saved before the setting existed have no defaultStyle at all.
    const legacy = createDocument()
    delete legacy.defaultStyle
    expect(defaultStyleOf(legacy)).toEqual(createDocument().defaultStyle)
    expect(defaultStyleOf(undefined).fill).toBe(DEFAULT_STYLE.fill)
  })

  it('setDefaultStyle patches, and fills the setting in on a legacy document', () => {
    const legacy = createDocument()
    delete legacy.defaultStyle
    useStore.setState({ document: legacy })
    useStore.getState().setDefaultStyle({ fill: '#123456' })
    const d = useStore.getState().document.defaultStyle
    expect(d.fill).toBe('#123456')
    expect(d.opacity).toBe(1)
  })
})

describe('newly drawn objects', () => {
  it('take the default fill, stroke and opacity', () => {
    useStore.getState().setDefaultStyle({ fill: '#ff0000', stroke: '#00ff00', strokeWidth: 4, opacity: 0.5 })
    useStore.getState().addShapeAt('rect', 100, 100)
    expect(newest().style).toMatchObject({ fill: '#ff0000', stroke: '#00ff00', strokeWidth: 4, opacity: 0.5 })
  })

  it('keep shape-specific colors and strokes, but still take the rest', () => {
    useStore.getState().setDefaultStyle({ fill: '#ff0000', stroke: '#00ff00', opacity: 0.5 })
    const plain = createShapeOfKind('heart', 0, 0)
    useStore.getState().addShapeAt('heart', 100, 100)
    expect(newest().style.fill).toBe(plain.style.fill) // suit red wins over the default
    expect(newest().style.opacity).toBe(0.5)

    useStore.getState().addShapeAt('cube', 100, 100)
    expect(newest().style.stroke).toBe(createShapeOfKind('cube', 0, 0).style.stroke)
  })

  it('leaves shapes untouched when no defaults are passed', () => {
    expect(createShapeOfKind('rect', 0, 0).style).toEqual(createShapeOfKind('rect', 0, 0, undefined).style)
  })

  it('applies to text, which keeps its own readable fill', () => {
    useStore.getState().setDefaultStyle({ fill: '#ff0000', opacity: 0.25 })
    useStore.getState().addTextAt(10, 10)
    expect(newest().type).toBe('text')
    expect(newest().style.fill).toBe('#1a1d21')
    expect(newest().style.opacity).toBe(0.25)
  })

  it('applies to pen paths — closed ones fully, open ones as a stroke', () => {
    useStore.getState().setDefaultStyle({ fill: '#ff0000', stroke: '#00ff00', strokeWidth: 3, opacity: 0.5 })
    useStore.getState().addPath('M 0 0 L 10 0 L 10 10 Z', true)
    expect(newest().style).toMatchObject({ fill: '#ff0000', stroke: '#00ff00', strokeWidth: 3, opacity: 0.5 })

    useStore.getState().addPath('M 0 0 L 10 0', false)
    expect(newest().style).toMatchObject({ fill: null, stroke: '#00ff00', strokeWidth: 3, opacity: 0.5 })
  })

  it('draws an open pen path with the ink line when no default stroke is set', () => {
    useStore.getState().addPath('M 0 0 L 10 0', false)
    expect(newest().style).toMatchObject({ fill: null, stroke: '#1a1d21', strokeWidth: 2 })
  })

  it('applies to placed images', () => {
    useStore.getState().setDefaultStyle({ opacity: 0.4 })
    useStore.getState().addImageAt('data:image/png;base64,x', 10, 10, 0, 0)
    expect(newest().type).toBe('image')
    expect(newest().style.opacity).toBe(0.4)
  })
})
