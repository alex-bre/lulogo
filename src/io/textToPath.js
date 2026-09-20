import { nodeCenter } from '../model/bbox'
import { textLines, lineStep, lineStartX, letterSpacingOf, widthScaleOf, glyphPenOffsets } from '../model/textMetrics'
import { fontKind, fontUrl, primaryFamily, resolveWeight, BRAND_FONTS, FALLBACK_FONTS } from '../model/fonts'

// Convert text nodes to vector paths using opentype.js + the bundled fonts,
// fetched on demand (the files live in public/fonts and are parsed only when the
// user exports with "text → paths"). The font tables live in model/fonts.js and
// are shared with the faces the canvas registers, so the export outlines exactly
// the face — and the weight — the user is looking at.

let opentypePromise
function getOpentype() {
  if (!opentypePromise) opentypePromise = import('opentype.js').then((m) => m.default || m)
  return opentypePromise
}

const fontCache = {}
function loadFont(opentype, url) {
  // opentype.js v2: fetch the font bytes and parse the ArrayBuffer.
  if (!fontCache[url]) {
    fontCache[url] = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`font ${url}: HTTP ${r.status}`)
        return r.arrayBuffer()
      })
      .then((buf) => opentype.parse(buf))
  }
  return fontCache[url]
}

/**
 * Pin a variable font to the node's weight. The browser instantiates the `wght`
 * axis from the CSS font-weight; opentype outlines the axis *default* unless
 * told otherwise (Outfit defaults to 100/Thin), so without this the export would
 * be a different weight than the canvas at every setting.
 */
function applyVariation(font, weight) {
  const axis = font.tables?.fvar?.axes?.find((a) => a.tag === 'wght')
  if (!axis || !font.variation) return
  font.variation.set({ wght: Math.min(axis.maxValue, Math.max(axis.minValue, weight)) })
}

/**
 * The opentype.Font to outline a text node with: a brand family from its own
 * file, anything else from the generic face its stack falls back to on canvas.
 *
 * The weight comes from resolveWeight, so it is one we actually shipped — which
 * means the bold file is only ever asked for when it loaded. No guessing, and no
 * fallback chain: if the file we picked won't load, something is wrong and the
 * generic substitute is a visible, reported degradation rather than a silent one.
 */
async function resolveFont(opentype, node) {
  const family = primaryFamily(node.fontFamily)
  const brand = BRAND_FONTS[family]
  const weight = resolveWeight(node.fontFamily, node.fontWeight)

  if (brand) {
    // A variable file covers its whole axis on its own (applyVariation pins it);
    // a static family needs the matching weight's file.
    const file = !brand.weightRange && weight >= 600 && brand.bold ? brand.bold : brand.regular
    try {
      const font = await loadFont(opentype, fontUrl(file))
      applyVariation(font, weight)
      return font
    } catch {
      console.warn(
        `text→paths: could not load public/fonts/${file} for "${family}". Outlining with the generic ` +
          `${fontKind(node.fontFamily)} face instead — the export will not match the canvas.`,
      )
    }
  }
  return loadFont(opentype, fontUrl(FALLBACK_FONTS[fontKind(node.fontFamily)].regular))
}

function transformCommands(commands, fn) {
  for (const c of commands) {
    if (c.x != null) {
      const p = fn(c.x, c.y)
      c.x = p.x
      c.y = p.y
    }
    if (c.x1 != null) {
      const p = fn(c.x1, c.y1)
      c.x1 = p.x
      c.y1 = p.y
    }
    if (c.x2 != null) {
      const p = fn(c.x2, c.y2)
      c.x2 = p.x
      c.y2 = p.y
    }
  }
}

/** Outline a single text node into SVG path data (page coordinates). */
export async function textNodeToPath(node) {
  const opentype = await getOpentype()
  const font = await resolveFont(opentype, node)
  const size = node.fontSize
  const step = lineStep(node)
  const ls = letterSpacingOf(node)

  // Lay the line out ourselves, glyph by glyph, instead of via font.getPath():
  //
  //  - opentype's shaper applies `ccmp` unconditionally and throws on GSUB
  //    lookup formats it hasn't implemented (Outfit and Space Mono trip it),
  //    which is why text→paths once produced nothing for them. A plain
  //    character→glyph mapping sidesteps the shaper entirely — the only loss is
  //    contextual substitution, i.e. the occasional ligature.
  //
  //  - opentype positions glyphs by their own advance widths, which for a
  //    variable font are the *default master's*: it reads neither the `gvar`
  //    phantom-point advance deltas nor `HVAR`. So a heavier weight would be
  //    spaced like the thin one — glyphs overlapping, the line ending short. We
  //    instead place each glyph where the browser lays it out, from a cumulative
  //    measureText of the line (pair kerning and any shaping included) — the
  //    same "measure with the browser, position it ourselves" trick lineStartX
  //    already uses for the start of each line. With no 2D context to measure
  //    with (jsdom) we fall back to the font's own advances.
  const path = new opentype.Path()
  textLines(node).forEach((line, i) => {
    if (!line) return
    const startX = lineStartX(node, line)
    const baseY = node.y + i * step
    const measured = glyphPenOffsets(node, line)
    const scale = size / font.unitsPerEm
    let penX = 0
    ;[...line].forEach((ch, j) => {
      const glyph = font.glyphs.get(font.charToGlyphIndex(ch))
      path.extend(glyph.getPath(startX + (measured ? measured[j] : penX), baseY, size, undefined, font))
      if (!measured) penX += (glyph.advanceWidth || 0) * scale + ls
    })
  })

  // Bake the horizontal glyph-width stretch (about the anchor) — same transform
  // the canvas applies to the <text>, done here so the path needs none.
  const f = widthScaleOf(node)
  if (f !== 1) transformCommands(path.commands, (px, py) => ({ x: node.x + f * (px - node.x), y: py }))

  // Bake the node's rotation/flip into the outline (about the text bbox center)
  // so the resulting path node needs no transform.
  if (node.rotation || node.flipX || node.flipY) {
    const c = nodeCenter(node)
    const r = ((node.rotation || 0) * Math.PI) / 180
    const cos = Math.cos(r)
    const sin = Math.sin(r)
    transformCommands(path.commands, (px, py) => {
      let X = px
      let Y = py
      if (node.flipX) X = 2 * c.x - X
      if (node.flipY) Y = 2 * c.y - Y
      const dx = X - c.x
      const dy = Y - c.y
      return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos }
    })
  }
  return path.toPathData(3)
}

/**
 * The path node a text node becomes once outlined. Shared by the SVG export and
 * the in-document "text → paths" command so the two produce the same node: the
 * outline already has the rotation/flip baked in, so it carries none itself.
 */
export function outlinedNode(node, d) {
  return {
    id: node.id,
    type: 'path',
    name: node.name,
    parent: node.parent,
    rotation: 0,
    flipX: false,
    flipY: false,
    locked: node.locked,
    hidden: node.hidden,
    d,
    style: { ...node.style },
  }
}

/**
 * Outline a batch of text nodes, keyed by id. Non-text and empty nodes are
 * skipped, and one whose font won't load is reported and left out rather than
 * failing the batch — callers leave those nodes as text.
 */
export async function outlineTextNodes(nodes) {
  const out = {}
  for (const n of nodes) {
    if (n.type !== 'text' || !n.text) continue
    try {
      out[n.id] = await textNodeToPath(n)
    } catch (e) {
      console.warn('text→path failed for', n.id, e)
    }
  }
  return out
}

/** Return a deep copy of the document with every text node replaced by a path. */
export async function convertTextToPaths(doc) {
  const out = JSON.parse(JSON.stringify(doc))
  const outlines = await outlineTextNodes(Object.values(out.nodes))
  for (const id in outlines) out.nodes[id] = outlinedNode(out.nodes[id], outlines[id])
  return out
}
