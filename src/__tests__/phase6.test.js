import { describe, it, expect } from 'vitest'
import { useStore } from '../state/store'
import { createDocument } from '../model/document'
import { createText, createRect, addNode } from '../model/nodes'
import { geometryBBox } from '../model/bbox'
import { ZERO_WIDTH, fontMetrics, firstBaselineOffset, lineStartX, lineWidth, textLines } from '../model/textMetrics'
import { resolveWeight, registerLoadedForTest } from '../model/fonts'
import { serializeDocument } from '../io/serialize'

describe('text store actions', () => {
  it('addTextAt creates a text node, selects it, and starts editing', () => {
    useStore.setState({ document: createDocument(), selection: [] })
    const id = useStore.getState().addTextAt(100, 100)
    const st = useStore.getState()
    expect(st.document.nodes[id].type).toBe('text')
    expect(st.selection).toEqual([id])
    expect(st.ui.editingTextId).toBe(id)
  })

  it('updateText only touches text nodes', () => {
    const doc = createDocument()
    const t = createText({ x: 0, y: 0, text: 'hi' })
    const r = createRect({ x: 0, y: 0, width: 10, height: 10 })
    addNode(doc, t)
    addNode(doc, r)
    useStore.setState({ document: doc, selection: [t.id, r.id] })
    useStore.getState().updateText([t.id, r.id], { fontSize: 48 })
    const st = useStore.getState()
    expect(st.document.nodes[t.id].fontSize).toBe(48)
    expect(st.document.nodes[r.id].fontSize).toBeUndefined()
  })

  it('changing align keeps the text block in place (moves the anchor, not the box)', () => {
    const doc = createDocument()
    const t = createText({ x: 100, y: 50, text: 'hello', align: 'start' })
    addNode(doc, t)
    useStore.setState({ document: doc, selection: [t.id] })
    const before = geometryBBox(useStore.getState().document.nodes[t.id]).x

    useStore.getState().updateText([t.id], { align: 'middle' })
    let n = useStore.getState().document.nodes[t.id]
    expect(n.align).toBe('middle')
    expect(geometryBBox(n).x).toBeCloseTo(before) // box didn't jump
    expect(n.x).toBeGreaterThan(100) // anchor moved to the box center

    useStore.getState().updateText([t.id], { align: 'end' })
    n = useStore.getState().document.nodes[t.id]
    expect(geometryBBox(n).x).toBeCloseTo(before)
  })
})

describe('text bbox honors the anchor', () => {
  // jsdom has no canvas, so textWidth falls back to length * size * 0.55.
  it('positions the box by alignment', () => {
    const base = { type: 'text', x: 100, y: 50, text: 'ab', fontSize: 10 }
    const w = 2 * 10 * 0.55
    expect(geometryBBox({ ...base, align: 'start' }).x).toBeCloseTo(100)
    expect(geometryBBox({ ...base, align: 'middle' }).x).toBeCloseTo(100 - w / 2)
    expect(geometryBBox({ ...base, align: 'end' }).x).toBeCloseTo(100 - w)
  })

  it('grows by one line step per line and takes the widest line', () => {
    const one = createText({ x: 0, y: 0, text: 'ab', fontSize: 10 })
    const two = createText({ x: 0, y: 0, text: 'ab\nabcd', fontSize: 10 })
    expect(geometryBBox(one).height).toBeCloseTo(12.5) // 10 * default line height 1.25
    expect(geometryBBox(two).height).toBeCloseTo(25)
    expect(geometryBBox(two).width).toBeCloseTo(geometryBBox({ ...one, text: 'abcd' }).width)
  })

  it('splits the leading evenly above and below the glyphs', () => {
    // jsdom reports no font metrics, so this uses the 0.8/0.2 em fallback.
    const n = createText({ x: 0, y: 100, text: 'ab', fontSize: 10 })
    const { ascent, descent } = fontMetrics(n)
    const b = geometryBBox(n)
    const above = 100 - b.y - ascent // slack between the box top and the ascender
    const below = b.y + b.height - 100 - descent
    expect(above).toBeCloseTo(below)
    expect(above).toBeGreaterThan(0)
  })

  it('places the first baseline one firstBaselineOffset below the top', () => {
    const n = createText({ x: 0, y: 100, text: 'a\nb', fontSize: 10 })
    expect(geometryBBox(n).y).toBeCloseTo(100 - firstBaselineOffset(n))
  })

  // The trailing gap CSS adds after the last glyph draws nothing, and engines
  // disagree on how it affects text-anchor — so we measure the visible gaps only.
  it('counts letter spacing between characters, not after the last one', () => {
    const plain = createText({ x: 0, y: 0, text: 'ab', fontSize: 10 })
    const spaced = createText({ x: 0, y: 0, text: 'ab', fontSize: 10, letterSpacing: 3 })
    expect(geometryBBox(spaced).width).toBeCloseTo(geometryBBox(plain).width + 1 * 3)
  })

  it('widthScale stretches the box width (not height), keeping the aligned edge pinned', () => {
    const base = { x: 200, y: 50, text: 'ab', fontSize: 10 }
    for (const align of ['start', 'middle', 'end']) {
      const b1 = geometryBBox(createText({ ...base, align, widthScale: 1 }))
      const b2 = geometryBBox(createText({ ...base, align, widthScale: 1.5 }))
      expect(b2.width).toBeCloseTo(b1.width * 1.5)
      expect(b2.height).toBeCloseTo(b1.height)
      const edge = (b) => (align === 'start' ? b.x : align === 'end' ? b.x + b.width : b.x + b.width / 2)
      expect(edge(b2)).toBeCloseTo(edge(b1)) // the anchor edge doesn't move
      expect(edge(b1)).toBeCloseTo(200)
    }
  })

  it('lineStartX justifies each line itself, so text-anchor is never needed', () => {
    const n = createText({ x: 100, y: 0, text: 'ab\nabcd', fontSize: 10, letterSpacing: 3, align: 'middle' })
    const [short, long] = textLines(n)
    // Each line is centered on the anchor, using its own visible width.
    expect(lineStartX(n, short)).toBeCloseTo(100 - lineWidth(n, short) / 2)
    expect(lineStartX(n, long)).toBeCloseTo(100 - lineWidth(n, long) / 2)
    // ...and the block's left edge is the widest line's start.
    expect(geometryBBox(n).x).toBeCloseTo(lineStartX(n, long))
  })
})

describe('text serialization', () => {
  it('emits a clean <text> element with content', () => {
    const doc = createDocument()
    addNode(doc, createText({ x: 20, y: 40, text: 'Hello' }))
    const svg = serializeDocument(doc)
    expect(svg).toMatch(/<text x="20" y="40" font-family="Inter, sans-serif" font-size="32" fill="#1a1d21">Hello<\/text>/)
    expect(svg).not.toContain('font-weight') // default 400 omitted
    expect(svg).not.toContain('text-anchor') // default start omitted
    expect(svg).not.toContain('letter-spacing') // default 0 omitted
    expect(svg).not.toContain('tspan') // a single line needs no tspan
  })

  it('emits one <tspan> per line, shifted a baseline step down', () => {
    const doc = createDocument()
    addNode(doc, createText({ x: 20, y: 40, text: 'a\n\nb', fontSize: 10, letterSpacing: 2 }))
    const svg = serializeDocument(doc)
    expect(svg).toContain('letter-spacing="2"')
    expect(svg).toContain('<tspan x="20">a</tspan>')
    expect(svg).toContain(`<tspan x="20" dy="12.5">${ZERO_WIDTH}</tspan>`) // blank line
    expect(svg).toContain('<tspan x="20" dy="12.5">b</tspan>')
  })
})

describe('no synthesized weights', () => {
  // Nothing is registered in jsdom (no FontFace), so resolveWeight passes the
  // request through — it must never invent a weight it can't back with a file.
  it('passes the weight through for families we do not bundle', () => {
    expect(resolveWeight('Arial, sans-serif', 700)).toBe(700)
    expect(resolveWeight('Inter, sans-serif', 400)).toBe(400)
  })

  it('clamps a variable brand font to its axis, and never past it', () => {
    registerLoadedForTest('outfit', { range: [100, 900] })
    expect(resolveWeight('Outfit, sans-serif', 700)).toBe(700)
    expect(resolveWeight('Outfit, sans-serif', 1000)).toBe(900)
    expect(resolveWeight('Outfit, sans-serif', 50)).toBe(100)
  })

  // The statics path stays exercised even though every bundled face is currently
  // variable: resolveWeight still serves any face shipped as discrete weights.
  it('falls back to the nearest SHIPPED weight when bold is missing', () => {
    registerLoadedForTest('static face', { statics: [400] }) // no bold file
    expect(resolveWeight('"Static Face", sans-serif', 700)).toBe(400) // not faked
    registerLoadedForTest('static face', { statics: [400, 700] }) // bold added
    expect(resolveWeight('"Static Face", sans-serif', 700)).toBe(700)
  })
})
