import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { useStore } from '../state/store'
import { initHistory, undo } from '../state/history'
import { createDocument } from '../model/document'
import { createText, createRect, addNode } from '../model/nodes'
import { textNodeToPath } from '../io/textToPath'
import { BRAND_FONTS, FALLBACK_FONTS } from '../model/fonts'
import StyleTab from '../panels/right/tabs/StyleTab'
import PathTools from '../panels/left/PathTools'

// Paper.js needs a canvas 2D context for setup, and outlining fetches the
// bundled fonts — serve those from disk.
beforeAll(() => {
  initHistory()
  HTMLCanvasElement.prototype.getContext = function () {
    return new Proxy(
      { canvas: this, measureText: (s) => ({ width: (s ? [...s].length : 0) * 20 }) },
      { get: (t, p) => (p in t ? t[p] : () => {}) },
    )
  }
  global.fetch = async (url) => {
    const name = String(url).split('/fonts/')[1]
    const buf = fs.readFileSync(path.resolve('public/fonts', name))
    return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) }
  }
})

afterEach(cleanup)

const seed = (nodes) => {
  const doc = createDocument()
  nodes.forEach((n) => addNode(doc, n))
  useStore.setState((s) => ({
    document: doc,
    selection: nodes.map((n) => n.id),
    past: [],
    future: [],
    ui: { ...s.ui, tool: 'select', rightTab: 'style', editingTextId: null, editingPathId: null },
  }))
}

// Every one of these buttons starts async work — a dynamic import, a font fetch
// — whose result lands in React state, so it has to settle inside act(). Polled
// rather than awaited through waitFor, which brings an act wrapper of its own
// and warns when nested inside this one.
const clickAndSettle = async (btn, done) => {
  await act(async () => {
    fireEvent.click(btn)
    for (let i = 0; i < 400 && !done(); i++) await new Promise((r) => setTimeout(r, 5))
  })
  expect(done()).toBe(true)
}

const only = () => {
  const nodes = useStore.getState().document.nodes
  const ids = Object.keys(nodes)
  expect(ids).toHaveLength(1)
  return nodes[ids[0]]
}

// opentype's shaper applies `ccmp` unconditionally and throws on GSUB lookup
// formats it hasn't implemented, which once silently broke text→paths for Outfit
// and for anything falling back to Space Mono. We outline glyph-by-glyph and
// never invoke the shaper — every face we ship must still outline.
describe('every bundled face outlines', () => {
  const families = [
    ...Object.values(BRAND_FONTS).map((b) => b.family),
    'Madeupface, sans-serif',
    'Madeupface, serif',
    'Madeupface, monospace',
  ]

  it.each(families)('outlines text set in %s', async (family) => {
    const node = createText({ x: 10, y: 40, text: 'Waffle fi 5', fontFamily: family, fontSize: 32 })
    const d = await textNodeToPath(node)
    expect(d).toMatch(/^M/)
    expect(d.length).toBeGreaterThan(100)
  })

  it('exercises all three fallback faces above', () => {
    expect(Object.keys(FALLBACK_FONTS)).toEqual(['sans', 'serif', 'mono'])
  })

  // opentype.js positions glyphs by the default master's advances even for a
  // pinned variable weight (it reads neither gvar phantom points nor HVAR), so
  // heavier weights used to come out compressed. We place every glyph at the
  // browser's measured pen x instead — here the mocked measureText is 20/char,
  // so each of the four identical glyphs must start exactly 20 further right.
  it('spaces glyphs by the browser measurement, not the font advance', async () => {
    const node = createText({ x: 0, y: 40, text: 'HHHH', fontFamily: 'Outfit, sans-serif', fontSize: 32, fontWeight: 700 })
    const d = await textNodeToPath(node)
    // One subpath (M) per contour; the four identical glyphs repeat the same
    // block of contours, so block k is block 0 shifted by 20k.
    const startXs = [...d.matchAll(/M\s*(-?[\d.]+)/g)].map((m) => Number(m[1]))
    const perGlyph = startXs.length / 4
    expect(Number.isInteger(perGlyph)).toBe(true)
    for (let i = perGlyph; i < startXs.length; i++) {
      expect(startXs[i] - startXs[i - perGlyph]).toBeCloseTo(20, 3)
    }
  })
})

describe('Style tab: convert to paths', () => {
  it('replaces the selected text with a path, keeping its id, name and style', async () => {
    const t = createText({ x: 10, y: 40, text: 'Hi', fontFamily: 'Outfit, sans-serif', style: { fill: '#123456' } })
    seed([t])
    render(<StyleTab />)

    await clickAndSettle(
      (await screen.findByText(/Convert to paths/)).closest('button'),
      () => useStore.getState().document.nodes[t.id].type === 'path',
    )

    const node = useStore.getState().document.nodes[t.id]
    expect(node.d).toMatch(/^M/)
    expect(node.name).toBe(t.name)
    expect(node.style.fill).toBe('#123456')
    expect(node.rotation).toBe(0) // the outline bakes rotation/flip in
    expect(useStore.getState().selection).toEqual([t.id])
  })

  it('is a single undo step', async () => {
    const t = createText({ x: 10, y: 40, text: 'Hi', fontFamily: 'Outfit, sans-serif' })
    seed([t])
    render(<StyleTab />)

    await clickAndSettle(
      (await screen.findByText(/Convert to paths/)).closest('button'),
      () => useStore.getState().document.nodes[t.id].type === 'path',
    )

    await act(async () => {
      undo()
    })
    expect(useStore.getState().document.nodes[t.id].type).toBe('text')
  })

  it('offers nothing to convert on a locked text node', async () => {
    const t = createText({ x: 10, y: 40, text: 'Hi', fontFamily: 'Outfit, sans-serif' })
    t.locked = true
    seed([t])
    render(<StyleTab />)

    expect((await screen.findByText(/Convert to paths/)).closest('button').disabled).toBe(true)
  })
})

describe('boolean ops outline text implicitly', () => {
  it('unites a text node with a rect', async () => {
    const t = createText({ x: 10, y: 40, text: 'Hi', fontFamily: 'Outfit, sans-serif' })
    const r = createRect({ x: 0, y: 0, width: 60, height: 60 })
    seed([t, r])
    render(<PathTools />)

    // Both operands are consumed into one merged path.
    await clickAndSettle(screen.getByTitle(/^Union/), () => !useStore.getState().document.nodes[t.id])

    expect(only().type).toBe('path')
  })

  it('subtracts a text node from the shape below it', async () => {
    const r = createRect({ x: 0, y: 0, width: 200, height: 100 })
    const t = createText({ x: 10, y: 60, text: 'Hi', fontFamily: 'Outfit, sans-serif' })
    seed([r, t])
    render(<PathTools />)

    await clickAndSettle(screen.getByTitle(/^Subtract/), () => !useStore.getState().document.nodes[t.id])

    // The letters are punched out of the rect, so the result is a compound path.
    expect(only().d.match(/M/g).length).toBeGreaterThan(1)
  })

  it('undoes the implicit outlining and the op together', async () => {
    const t = createText({ x: 10, y: 40, text: 'Hi', fontFamily: 'Outfit, sans-serif' })
    const r = createRect({ x: 0, y: 0, width: 60, height: 60 })
    seed([t, r])
    render(<PathTools />)

    await clickAndSettle(screen.getByTitle(/^Union/), () => !useStore.getState().document.nodes[t.id])

    await act(async () => {
      undo()
    })
    const doc = useStore.getState().document
    expect(doc.nodes[t.id].type).toBe('text')
    expect(doc.nodes[r.id].type).toBe('rect')
  })
})
