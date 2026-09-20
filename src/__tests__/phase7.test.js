import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { useStore } from '../state/store'
import { createDocument } from '../model/document'
import { createPath, createText, addNode } from '../model/nodes'
import { convertTextToPaths } from '../io/textToPath'
import { fontKind, renderFontFamily, resolveWeight } from '../model/fonts'
import { importSvgToNodes } from '../io/importSvg'
import { geometryBBox } from '../model/bbox'

// Paper.js needs a canvas 2D context for setup (geometry math is independent),
// and text→paths fetches the bundled fonts — serve them from disk in tests.
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = function () {
    return new Proxy(
      { canvas: this, measureText: () => ({ width: 0 }) },
      { get: (t, p) => (p in t ? t[p] : () => {}) },
    )
  }
  global.fetch = async (url) => {
    const name = String(url).split('/fonts/')[1]
    const buf = fs.readFileSync(path.resolve('public/fonts', name))
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    return { ok: true, arrayBuffer: async () => ab }
  }
})

const fresh = () => useStore.setState({ document: createDocument(), selection: [] })

describe('fontKind mapping', () => {
  it('maps families to a bundled face', () => {
    expect(fontKind('Inter, sans-serif')).toBe('sans')
    expect(fontKind('Arial, Helvetica, sans-serif')).toBe('sans')
    expect(fontKind('Georgia, serif')).toBe('serif')
    expect(fontKind('"Times New Roman", Times, serif')).toBe('serif')
    expect(fontKind('"Courier New", monospace')).toBe('mono')
  })
})

describe('fallback splicing', () => {
  // A generic keyword always resolves to something, so a fallback listed after
  // one is unreachable and the canvas would drift from the export.
  it('inserts the bundled face ahead of the generic keyword', () => {
    expect(renderFontFamily('Madeupface, sans-serif')).toBe('Madeupface, "IC Fallback Sans", sans-serif')
  })

  it('appends the bundled face when the stack names no generic', () => {
    expect(renderFontFamily('Madeupface')).toBe('Madeupface, "IC Fallback Sans"')
  })

  it('matches the fallback to the kind of the requested family', () => {
    expect(renderFontFamily('Madeupface, serif')).toContain('"IC Fallback Serif"')
    expect(renderFontFamily('Madeupface, monospace')).toContain('"IC Fallback Mono"')
  })

  // Documents can name fonts this build does not ship — a face dropped from the
  // bundle, or one that only ever existed on the author's machine. They get the
  // ordinary fallback rather than any per-font handling, so what is drawn and
  // what is outlined stay the same face.
  it('resolves an unavailable family to a bundled face', () => {
    const stack = renderFontFamily('Nolongerbundled, sans-serif')
    expect(stack).toContain('"IC Fallback Sans"')
    expect(resolveWeight('Nolongerbundled, sans-serif', 700)).toBe(700)
  })
})

describe('import store actions', () => {
  it('adds a single imported node at the top level', () => {
    fresh()
    const n = createPath({ d: 'M0 0 L10 0' })
    useStore.getState().addImportedNodes([n])
    const st = useStore.getState()
    expect(st.document.rootOrder).toEqual([n.id])
    expect(st.selection).toEqual([n.id])
  })

  it('wraps multiple imported nodes in a named group', () => {
    fresh()
    const a = createPath({ d: 'M0 0' })
    const b = createPath({ d: 'M1 1' })
    useStore.getState().addImportedNodes([a, b], 'logo')
    const st = useStore.getState()
    const gid = st.selection[0]
    const g = st.document.nodes[gid]
    expect(g.type).toBe('group')
    expect(g.name).toBe('logo')
    expect(g.children).toEqual([a.id, b.id])
  })

  it('adds an image at its native pixel size, selected', () => {
    fresh()
    useStore.getState().addImageAt('data:image/png;base64,AAAA', 2000, 1000, 100, 100)
    const st = useStore.getState()
    const node = st.document.nodes[st.selection[0]]
    expect(node.type).toBe('image')
    expect(node.width).toBe(2000)
    expect(node.height).toBe(1000)
    expect(node.href).toMatch(/^data:image\/png/)
  })
})

describe('SVG import (Paper.js)', () => {
  it('imports a rect as a path with its fill', async () => {
    const { nodes } = await importSvgToNodes(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="10" height="10" fill="#ff0000"/></svg>',
    )
    expect(nodes).toHaveLength(1)
    expect(nodes[0].type).toBe('path')
    expect(nodes[0].d).toBeTruthy()
    expect(nodes[0].style.fill).toBe('#ff0000')
  })

  it('bakes group/viewBox transforms into geometry (correct bbox)', async () => {
    const { nodes } = await importSvgToNodes(
      '<svg xmlns="http://www.w3.org/2000/svg"><g transform="translate(100,50)">' +
        '<rect x="0" y="0" width="10" height="20"/></g></svg>',
    )
    const path = nodes.find((n) => n.type === 'path')
    const b = geometryBBox(path)
    expect(b.x).toBeCloseTo(100)
    expect(b.y).toBeCloseTo(50)
    expect(b.width).toBeCloseTo(10)
    expect(b.height).toBeCloseTo(20)
  })

  it('loads a linear gradient fill as a document gradient', async () => {
    const { nodes, gradients } = await importSvgToNodes(
      '<svg xmlns="http://www.w3.org/2000/svg"><defs>' +
        '<linearGradient id="g" x1="0" y1="0" x2="1" y2="0">' +
        '<stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/>' +
        '</linearGradient></defs>' +
        '<rect x="0" y="0" width="10" height="10" fill="url(#g)"/></svg>',
    )
    const ids = Object.keys(gradients)
    expect(ids).toHaveLength(1)
    expect(nodes[0].style.fill).toBe(`url(#${ids[0]})`)
    const g = gradients[ids[0]]
    expect(g.type).toBe('linear')
    expect(g.stops).toHaveLength(2)
    expect(g.stops[0].color).toBe('#ff0000')
    expect(g.stops[1].color).toBe('#0000ff')
  })
})

describe('SVG import — clipping', () => {
  it('bakes a clip-path into the shape and drops the clip outline', async () => {
    const { nodes } = await importSvgToNodes(
      '<svg xmlns="http://www.w3.org/2000/svg"><defs>' +
        '<clipPath id="c"><rect x="0" y="0" width="50" height="50"/></clipPath></defs>' +
        '<rect x="25" y="25" width="100" height="100" fill="#ff0000" clip-path="url(#c)"/></svg>',
    )
    // Only the clipped shape — the clip rect is not a visible node.
    expect(nodes).toHaveLength(1)
    expect(nodes[0].type).toBe('path')
    expect(nodes[0].style.fill).toBe('#ff0000')
    const b = geometryBBox(nodes[0])
    expect(b.x).toBeCloseTo(25)
    expect(b.y).toBeCloseTo(25)
    expect(b.width).toBeCloseTo(25)
    expect(b.height).toBeCloseTo(25)
  })

  it('clips a group to a referenced clipPath', async () => {
    const { nodes } = await importSvgToNodes(
      '<svg xmlns="http://www.w3.org/2000/svg"><defs>' +
        '<clipPath id="c"><circle cx="50" cy="50" r="30"/></clipPath></defs>' +
        '<g clip-path="url(#c)"><rect x="0" y="0" width="200" height="200" fill="#00ff00"/></g></svg>',
    )
    expect(nodes).toHaveLength(1)
    const b = geometryBBox(nodes[0])
    expect(b.x).toBeCloseTo(20, 0)
    expect(b.y).toBeCloseTo(20, 0)
    expect(b.width).toBeCloseTo(60, 0)
    expect(b.height).toBeCloseTo(60, 0)
  })

  it('intersects nested clips', async () => {
    const { nodes } = await importSvgToNodes(
      '<svg xmlns="http://www.w3.org/2000/svg"><defs>' +
        '<clipPath id="a"><rect x="0" y="0" width="60" height="60"/></clipPath>' +
        '<clipPath id="b"><rect x="40" y="40" width="60" height="60"/></clipPath></defs>' +
        '<g clip-path="url(#a)"><g clip-path="url(#b)">' +
        '<rect x="0" y="0" width="200" height="200" fill="#123456"/></g></g></svg>',
    )
    expect(nodes).toHaveLength(1)
    const b = geometryBBox(nodes[0])
    expect(b.x).toBeCloseTo(40)
    expect(b.y).toBeCloseTo(40)
    expect(b.width).toBeCloseTo(20)
    expect(b.height).toBeCloseTo(20)
  })

  it('drops a shape that lies entirely outside its clip', async () => {
    const { nodes } = await importSvgToNodes(
      '<svg xmlns="http://www.w3.org/2000/svg"><defs>' +
        '<clipPath id="c"><rect x="0" y="0" width="10" height="10"/></clipPath></defs>' +
        '<rect x="100" y="100" width="20" height="20" clip-path="url(#c)"/></svg>',
    )
    expect(nodes).toHaveLength(0)
  })

  it('treats a solid-white <mask> (Figma-style frame) as a clip', async () => {
    const { nodes } = await importSvgToNodes(
      '<svg xmlns="http://www.w3.org/2000/svg"><defs>' +
        '<mask id="m"><rect x="0" y="0" width="40" height="40" fill="white"/></mask></defs>' +
        '<g mask="url(#m)"><rect x="10" y="10" width="200" height="200" fill="#0000ff"/></g></svg>',
    )
    expect(nodes).toHaveLength(1)
    const b = geometryBBox(nodes[0])
    expect(b.x).toBeCloseTo(10)
    expect(b.y).toBeCloseTo(10)
    expect(b.width).toBeCloseTo(30)
    expect(b.height).toBeCloseTo(30)
  })

  it('flattens a <g> transform inside a shape-only <mask> onto the clip', async () => {
    const { nodes } = await importSvgToNodes(
      '<svg xmlns="http://www.w3.org/2000/svg">' +
        '<g mask="url(#m)"><rect x="0" y="0" width="300" height="300" fill="#abcdef"/></g>' +
        '<defs><mask id="m" style="mask-type:alpha" maskUnits="userSpaceOnUse">' +
        '<g transform="translate(50,50)"><rect width="40" height="40" fill="white"/></g>' +
        '</mask></defs></svg>',
    )
    expect(nodes).toHaveLength(1)
    const b = geometryBBox(nodes[0])
    expect(b.x).toBeCloseTo(50)
    expect(b.y).toBeCloseTo(50)
    expect(b.width).toBeCloseTo(40)
    expect(b.height).toBeCloseTo(40)
  })

  it('leaves a partial-opacity <mask> alone (imports unmasked, no crash)', async () => {
    const { nodes } = await importSvgToNodes(
      '<svg xmlns="http://www.w3.org/2000/svg"><defs>' +
        '<mask id="m"><rect x="0" y="0" width="40" height="40" fill="white" fill-opacity="0.5"/></mask></defs>' +
        '<g mask="url(#m)"><rect x="10" y="10" width="50" height="50" fill="#0000ff"/></g></svg>',
    )
    expect(nodes).toHaveLength(1)
    const b = geometryBBox(nodes[0])
    expect(b.width).toBeCloseTo(50)
    expect(b.height).toBeCloseTo(50)
  })

  it('expands <use> of a <symbol> to a glyph filled with the <use> context colour', async () => {
    // Cairo/PDF-style text: each glyph is a <symbol> whose path carries no fill;
    // the colour is on the enclosing <g>. The glyph must import filled with that
    // colour, not dropped and not left as the black SVG default.
    const { nodes } = await importSvgToNodes(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">' +
        '<defs><symbol overflow="visible" id="g0">' +
        '<path style="stroke:none;" d="M 0 0 L 10 0 L 10 -20 L 0 -20 Z"/></symbol></defs>' +
        '<g style="fill:rgb(20%,60%,40%);"><use xlink:href="#g0" x="30" y="50"/></g></svg>',
    )
    expect(nodes).toHaveLength(1)
    expect(nodes[0].type).toBe('path')
    expect(nodes[0].style.fill).toBe('#339966')
    const b = geometryBBox(nodes[0])
    expect(b.x).toBeCloseTo(30)
    expect(b.y).toBeCloseTo(30)
    expect(b.width).toBeCloseTo(10)
    expect(b.height).toBeCloseTo(20)
  })

  it('keeps a rounded clip smooth when a straight container is clipped to it twice', async () => {
    // A rectangular gradient container clipped to a circle, with the circle
    // clip emitted twice (as exporters do). The result must stay curved — the
    // boolean op on coincident / duplicated edges used to facet it into lines.
    const circle =
      '<path d="M 50 20 C 66.6 20 80 33.4 80 50 C 80 66.6 66.6 80 50 80 C 33.4 80 20 66.6 20 50 C 20 33.4 33.4 20 50 20 Z"/>'
    const { nodes } = await importSvgToNodes(
      '<svg xmlns="http://www.w3.org/2000/svg"><defs>' +
        `<clipPath id="a">${circle}</clipPath><clipPath id="b">${circle}</clipPath></defs>` +
        '<g clip-path="url(#a)"><g clip-path="url(#b)">' +
        '<rect x="0" y="0" width="200" height="200" fill="#123456"/></g></g></svg>',
    )
    expect(nodes).toHaveLength(1)
    const d = nodes[0].d
    expect((d.match(/[cC]/g) || []).length).toBeGreaterThanOrEqual(4)
    expect((d.match(/[lL]/g) || []).length).toBe(0)
    const b = geometryBBox(nodes[0])
    expect(b.width).toBeCloseTo(60, 0)
    expect(b.height).toBeCloseTo(60, 0)
  })
})

describe('text → paths (opentype.js + bundled font)', () => {
  it('replaces a text node with an outlined path that keeps the fill', async () => {
    const doc = createDocument()
    const t = createText({ x: 10, y: 40, text: 'Hi', fontFamily: 'Inter, sans-serif', style: { fill: '#123456' } })
    addNode(doc, t)
    const out = await convertTextToPaths(doc)
    const node = out.nodes[t.id]
    expect(node.type).toBe('path')
    expect(node.d).toMatch(/^M/)
    expect(node.style.fill).toBe('#123456')
  })
})
