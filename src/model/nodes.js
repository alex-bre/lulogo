import { DEFAULT_LINE_HEIGHT } from './textMetrics'

// Node factories and the default style. Geometry is stored in *page
// coordinates* (rect x/y, ellipse cx/cy, path d). Only rotation + flip live
// outside geometry, so ordinary moves/resizes emit no transform on export.

let counter = 0

export function genId(prefix = 'n') {
  counter += 1
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}`
}

const round = (n) => Math.round(n * 100) / 100

// Defaults chosen to render nicely; the serializer drops any value equal to an
// SVG default so exports stay clean.
export const DEFAULT_STYLE = {
  fill: '#9aa6b2',
  fillOpacity: 1,
  stroke: null,
  strokeWidth: 1,
  strokeOpacity: 1,
  opacity: 1,
  lineCap: 'butt',
  lineJoin: 'miter',
  dash: null,
}

// The style every object has in common, and the part of it the General tab
// exposes as a document-wide default for newly drawn objects
// (model/document.js: `defaultStyle`).
export const DEFAULT_STYLE_KEYS = ['fill', 'stroke', 'strokeWidth', 'opacity']

/** A fresh copy of the factory values for those keys. */
export function newObjectStyle() {
  const out = {}
  for (const k of DEFAULT_STYLE_KEYS) out[k] = DEFAULT_STYLE[k]
  return out
}

/**
 * Apply the document's default style to a freshly created node, in place.
 *
 * A key is only taken where the node still carries the factory default for it,
 * so a shape's own accents survive the document default: the card suits stay
 * red/black, the cube keeps its wireframe stroke, text keeps its dark fill.
 * Returns the node.
 */
export function applyDefaultStyle(node, defaults) {
  if (!node || !defaults || !node.style) return node
  for (const k of DEFAULT_STYLE_KEYS) {
    if (defaults[k] === undefined) continue
    if (node.style[k] === DEFAULT_STYLE[k]) node.style[k] = defaults[k]
  }
  return node
}

function base(type, name) {
  return {
    id: genId(type),
    type,
    name: name || type,
    parent: null,
    rotation: 0, // degrees, about the geometry bbox center
    flipX: false,
    flipY: false,
    locked: false,
    hidden: false,
    style: { ...DEFAULT_STYLE },
  }
}

export function createRect({ x = 0, y = 0, width = 100, height = 100, rx = 0, style, ...rest } = {}) {
  return { ...base('rect', 'Rectangle'), x, y, width, height, rx, ...rest, style: { ...DEFAULT_STYLE, ...style } }
}

export function createEllipse({ cx = 0, cy = 0, rx = 50, ry = 50, style, ...rest } = {}) {
  return { ...base('ellipse', 'Ellipse'), cx, cy, rx, ry, ...rest, style: { ...DEFAULT_STYLE, ...style } }
}

export function createPath({ d = '', style, ...rest } = {}) {
  return { ...base('path', 'Path'), d, ...rest, style: { ...DEFAULT_STYLE, ...style } }
}

export function createLine({ x1 = 0, y1 = 0, x2 = 100, y2 = 0, style, ...rest } = {}) {
  return {
    ...base('line', 'Line'),
    x1,
    y1,
    x2,
    y2,
    ...rest,
    style: { ...DEFAULT_STYLE, fill: null, stroke: '#1a1d21', strokeWidth: 2, ...style },
  }
}

export function createPolygon({ points = [], closed = true, name, style, ...rest } = {}) {
  return { ...base('polygon', name || 'Polygon'), points, closed, ...rest, style: { ...DEFAULT_STYLE, ...style } }
}

/** Vertices of a regular n-gon, centered at (cx,cy), starting at rotDeg. */
export function regularPolygonPoints(cx, cy, r, n, rotDeg = -90) {
  const off = (rotDeg * Math.PI) / 180
  const pts = []
  for (let i = 0; i < n; i++) {
    const a = off + (i * 2 * Math.PI) / n
    pts.push([round(cx + r * Math.cos(a)), round(cy + r * Math.sin(a))])
  }
  return pts
}

/** Vertices of an n-point star alternating between outer and inner radius. */
export function starPoints(cx, cy, outer, inner, n, rotDeg = -90) {
  const off = (rotDeg * Math.PI) / 180
  const pts = []
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? outer : inner
    const a = off + (i * Math.PI) / n
    pts.push([round(cx + r * Math.cos(a)), round(cy + r * Math.sin(a))])
  }
  return pts
}

export function createImage({ x = 0, y = 0, width = 0, height = 0, href = '', style, ...rest } = {}) {
  return { ...base('image', 'Image'), x, y, width, height, href, ...rest, style: { ...DEFAULT_STYLE, ...style } }
}

// `text` may contain newlines; each line is rendered as its own baseline,
// `lineHeight` apart. `letterSpacing` is in page units (like fontSize).
// `widthScale` stretches the glyphs horizontally (1 = natural).
export function createText({ x = 0, y = 0, text = 'Text', fontFamily = 'Inter, sans-serif', fontSize = 32, fontWeight = 400, fontStyle = 'normal', align = 'start', lineHeight = DEFAULT_LINE_HEIGHT, letterSpacing = 0, widthScale = 1, style, ...rest } = {}) {
  return {
    ...base('text', 'Text'),
    x,
    y,
    text,
    fontFamily,
    fontSize,
    fontWeight,
    fontStyle,
    align,
    lineHeight,
    letterSpacing,
    widthScale,
    ...rest,
    style: { ...DEFAULT_STYLE, fill: '#1a1d21', ...style },
  }
}

export function createGroup({ name = 'Group', children = [], style, ...rest } = {}) {
  // Groups carry no fill/stroke by default so they don't override child styles
  // (or pollute the export). A style (e.g. group opacity) can still be passed.
  return { ...base('group', name), children, ...rest, style: { ...style } }
}

/**
 * Insert a node into a document (mutates — call inside an immer draft or on a
 * freshly-built plain document). Appends to the parent group's children, or to
 * rootOrder when parentId is null. Returns the node id.
 */
export function addNode(doc, node, parentId = null) {
  node.parent = parentId
  doc.nodes[node.id] = node
  const parent = parentId ? doc.nodes[parentId] : null
  if (parent && parent.type === 'group') parent.children.push(node.id)
  else doc.rootOrder.push(node.id)
  return node.id
}
