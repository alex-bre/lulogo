// Measure text via a cached offscreen canvas 2D context. Falls back to a
// rough estimate when no real context is available (e.g. jsdom in tests).

import { renderFontFamily, resolveWeight } from './fonts'

let ctx
let inited = false
function getCtx() {
  if (!inited) {
    inited = true
    try {
      ctx = document.createElement('canvas').getContext('2d')
    } catch {
      ctx = null
    }
  }
  return ctx
}

/** Default baseline-to-baseline distance, as a multiple of the font size. */
export const DEFAULT_LINE_HEIGHT = 1.25

/** Stand-in glyph (U+200B) for a blank line, so its `dy` has a character to apply to. */
export const ZERO_WIDTH = '\u200b'

// Ascent/descent as a fraction of the em, used when no real metrics exist.
const FALLBACK_ASCENT = 0.8
const FALLBACK_DESCENT = 0.2

export const lineHeightOf = (node) => node.lineHeight ?? DEFAULT_LINE_HEIGHT
export const letterSpacingOf = (node) => node.letterSpacing || 0

/** The node's content split into rendered lines (always at least one). */
export function textLines(node) {
  return String(node.text ?? '').split('\n')
}

/** Baseline-to-baseline distance in page units. */
export function lineStep(node) {
  return node.fontSize * lineHeightOf(node)
}

function fontString(node, size = node.fontSize) {
  // Measure exactly what gets rendered: the same stack (bundled fallback
  // appended) at the same real weight (never a synthesized one), so the box and
  // the on-canvas glyphs agree.
  const weight = resolveWeight(node.fontFamily, node.fontWeight)
  return `${node.fontStyle || 'normal'} ${weight} ${size}px ${renderFontFamily(node.fontFamily)}`
}

// Ascent/descent depend on the face, not the content, and scale linearly with
// the size — so measure each face once at a reference size and scale from
// there, instead of caching an entry per size a resize drag happens to pass
// through.
// Fonts are installed before the first paint (see main.jsx), so a face measured
// here is always the final one — no invalidation needed.
const REF_SIZE = 100
const metricsCache = new Map()

function faceMetrics(node) {
  const key = fontString(node, REF_SIZE)
  let m = metricsCache.get(key)
  if (m) return m

  const c = getCtx()
  if (c) {
    c.font = key
    const tm = c.measureText('Hg')
    if (tm.fontBoundingBoxAscent != null && tm.fontBoundingBoxDescent != null) {
      m = { ascent: tm.fontBoundingBoxAscent / REF_SIZE, descent: tm.fontBoundingBoxDescent / REF_SIZE }
    }
  }
  if (!m) m = { ascent: FALLBACK_ASCENT, descent: FALLBACK_DESCENT }

  metricsCache.set(key, m)
  return m
}

/**
 * The font's ascent and descent above/below the baseline, in page units. These
 * are the same values the browser lays a CSS line box out from, so a bbox built
 * on them lines up exactly with the HTML text editor overlaid on it.
 */
export function fontMetrics(node) {
  const m = faceMetrics(node)
  return { ascent: m.ascent * node.fontSize, descent: m.descent * node.fontSize }
}

/**
 * Distance from the top of the text block down to the first baseline. A line
 * box is `lineStep` tall but the glyphs only occupy ascent+descent of it; CSS
 * splits the remaining leading evenly above and below (the "half-leading"
 * model), and we match that so the box sits symmetrically around the text.
 */
export function firstBaselineOffset(node) {
  const { ascent, descent } = fontMetrics(node)
  const halfLeading = (lineStep(node) - (ascent + descent)) / 2
  return halfLeading + ascent
}

/**
 * Visible width of one line: the glyph advances plus the letter-spacing gaps
 * *between* them.
 *
 * CSS and SVG also add a gap after the LAST character, which grows the advance
 * but draws nothing. That trailing gap is where engines disagree — it shifts
 * where `text-anchor` thinks the string ends, so Firefox and Chromium place
 * centered/right-aligned spaced text differently. We therefore ignore it and
 * never rely on `text-anchor`: `lineStartX` positions every line itself. What
 * you see is `n - 1` gaps, so that is what we measure.
 */
export function lineWidth(node, line) {
  const text = line || ''
  const gaps = Math.max(0, text.length - 1) * letterSpacingOf(node)
  const c = getCtx()
  if (c) {
    c.font = fontString(node)
    const w = c.measureText(text).width
    if (w) return w + gaps
  }
  // Fallback: average glyph ~0.55em.
  return text.length * node.fontSize * 0.55 + gaps
}

/** Width of the widest line — the width of the text block. */
export function textWidth(node) {
  let w = 0
  for (const line of textLines(node)) w = Math.max(w, lineWidth(node, line))
  return w
}

/**
 * Horizontal glyph-width scale (1 = natural). Stretches the characters
 * themselves — the SVG-native equivalent is `textLength` + `lengthAdjust=
 * "spacingAndGlyphs"`, but we apply it as a `scaleX` about the anchor instead so
 * our own line positioning (and its cross-browser letter-spacing handling) is
 * untouched. `letterSpacing` is measured natural and scales along with it.
 */
export const widthScaleOf = (node) => (node.widthScale > 0 ? node.widthScale : 1)

const round3 = (n) => Math.round(n * 1000) / 1000

/**
 * SVG transform that stretches a text node's glyphs horizontally about its
 * anchor `x`, or null at natural width. Applied *inside* the node's rotation/
 * flip so the two compose the same way on canvas, in export, and when outlined.
 */
export function widthScaleTransform(node) {
  const f = widthScaleOf(node)
  if (f === 1) return null
  return `translate(${round3(node.x)} 0) scale(${round3(f)} 1) translate(${round3(-node.x)} 0)`
}

// How far into the text block `node.x` sits, per alignment.
export const ANCHOR_FRAC = { start: 0, middle: 0.5, end: 1 }

/**
 * Where a line's glyphs start, in page coords. This is what `text-anchor` would
 * compute — but done here, from our own metrics, so every renderer (canvas SVG,
 * exported SVG, outlined paths) puts the line in the same place no matter how
 * the engine treats the trailing letter-spacing gap. Callers pair this with
 * text-anchor="start".
 */
export function lineStartX(node, line) {
  return node.x - (ANCHOR_FRAC[node.align] ?? 0) * lineWidth(node, line)
}

/**
 * The pen x of every character in `line`, in page units, relative to the line's
 * start — the browser's own layout, taken from a cumulative `measureText` of the
 * growing prefix (so pair kerning and any shaping are baked in) plus the
 * letter-spacing gap that precedes each character. `offsets[j]` is where the
 * j-th character's glyph begins; there are as many entries as code points.
 *
 * Returns `null` when there is no 2D context to measure with (jsdom): callers
 * then fall back to the outline font's own advances.
 *
 * text→paths uses this to drop each glyph outline exactly where the canvas draws
 * it, rather than trusting opentype.js's advances — those ignore a variable
 * font's advance-width variations, so heavier weights would pack too tight.
 */
export function glyphPenOffsets(node, line) {
  const c = getCtx()
  if (!c) return null
  c.font = fontString(node)
  const ls = letterSpacingOf(node)
  const chars = [...String(line)]
  const offsets = new Array(chars.length)
  let prefix = ''
  for (let j = 0; j < chars.length; j++) {
    offsets[j] = (c.measureText(prefix).width || 0) + j * ls
    prefix += chars[j]
  }
  return offsets
}
