import { createDocument } from '../model/document'
import { createRect, createEllipse, createPolygon, createPath, createText, createImage, createGroup, addNode, genId } from '../model/nodes'
import { firstBaselineOffset, lineStep, lineWidth, textLines } from '../model/textMetrics'
import { geometryBBox, nodeBounds, unionBBox } from '../model/bbox'
import { translateNode } from '../model/mutate'
import { readTextChunk } from './pngChunks'

// draw.io (diagrams.net) diagrams, turned into a document of plain shapes.
//
// The source comes in four wrappings, all of them the same `<mxfile>` XML:
//   .drawio / .xml   the XML itself
//   .drawio.svg      in the root <svg>'s `content` attribute
//   .drawio.png      in a tEXt chunk keyed `mxfile`, URI-encoded
//   .html export     in a `data-mxgraph` JSON attribute
// Each <diagram> (page) is either a plain <mxGraphModel> or that model
// URI-encoded, raw-deflated and base64'd.
//
// What maps across: rectangles (rounded too), ellipses, rhombi, triangles,
// hexagons, lines, images and swimlanes, each with its label as a text object;
// connectors as polylines with simple arrowheads; groups, containers, layers
// and pages as groups. Any other shape falls back to its bounding rectangle,
// so nothing silently disappears.

const SOURCE = /<(mxfile|mxGraphModel)\b/

// draw.io's own stylesheet defaults (default.xml), which files don't repeat.
const VERTEX_DEFAULTS = { fillColor: 'default', strokeColor: 'default', fontColor: 'default', fontSize: '12' }
const EDGE_DEFAULTS = { strokeColor: 'default', fontColor: 'default', fontSize: '11', endArrow: 'classic', labelBackgroundColor: 'default' }
// Named styles (the bare word at the front of a style string) that change defaults.
const NAMED = {
  text: { fillColor: 'none', strokeColor: 'none' },
  group: { fillColor: 'none', strokeColor: 'none' },
  edgeLabel: { fillColor: 'none', strokeColor: 'none', fontSize: '11', labelBackgroundColor: 'default' },
  swimlane: { verticalAlign: 'top', fontStyle: '1', startSize: '23' },
}

const MARGIN = 20
const PAGE_GAP = 60

/* ---------------- finding the source ---------------- */

const decodeUri = (s) => {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** The draw.io XML in a .drawio/.xml/.svg/.html file's text, or null. */
export function drawioXmlFromText(text) {
  if (!text || !/mxfile|mxGraphModel/.test(text)) return null
  if (/^\s*(<\?xml[^>]*>\s*)?<(mxfile|mxGraphModel)\b/.test(text)) return text
  // The HTML parser reads both wrappings and decodes the attribute's entities.
  const dom = new DOMParser().parseFromString(text, 'text/html')
  const content = dom.querySelector('svg[content]')?.getAttribute('content')
  if (content && SOURCE.test(content)) return content
  const graph = dom.querySelector('[data-mxgraph]')?.getAttribute('data-mxgraph')
  try {
    const xml = graph && JSON.parse(graph).xml
    if (xml && SOURCE.test(xml)) return xml
  } catch {
    // not draw.io's JSON after all
  }
  return null
}

/** The draw.io XML in a .drawio.png's bytes, or null. */
export function drawioXmlFromPng(bytes) {
  const text = readTextChunk(bytes, 'mxfile')
  const xml = text == null ? null : decodeUri(text)
  return xml && SOURCE.test(xml) ? xml : null
}

export async function drawioDocumentFromText(text) {
  const xml = drawioXmlFromText(text)
  return xml ? drawioToDocument(xml) : null
}

export async function drawioDocumentFromPng(bytes) {
  const xml = drawioXmlFromPng(bytes)
  return xml ? drawioToDocument(xml) : null
}

function parseXml(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  if (doc.getElementsByTagName('parsererror').length) {
    throw new Error('This draw.io diagram is damaged and could not be read.')
  }
  return doc.documentElement
}

// A compressed page: base64 → raw deflate → URI-encoded XML.
async function inflate(b64) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  const stream = new Response(bytes).body.pipeThrough(new DecompressionStream('deflate-raw'))
  return decodeUri(await new Response(stream).text())
}

async function readPages(xml) {
  const root = parseXml(xml)
  if (root.nodeName === 'mxGraphModel') return [{ name: 'Page-1', model: root }]
  const pages = []
  for (const d of Array.from(root.getElementsByTagName('diagram'))) {
    let model = d.getElementsByTagName('mxGraphModel')[0]
    const packed = d.textContent.trim()
    if (!model && packed) {
      try {
        model = parseXml(await inflate(packed))
      } catch {
        throw new Error('This draw.io diagram is damaged and could not be read.')
      }
    }
    if (model) pages.push({ name: d.getAttribute('name') || `Page-${pages.length + 1}`, model })
  }
  return pages
}

/* ---------------- cells ---------------- */

function parseStyle(s) {
  const st = {}
  for (const part of (s || '').split(';')) {
    if (!part) continue
    const i = part.indexOf('=')
    if (i < 0) st.base ??= part
    else st[part.slice(0, i)] = part.slice(i + 1)
  }
  return st
}

const num = (el, a) => parseFloat(el.getAttribute(a)) || 0
const pt = (el) => ({ x: num(el, 'x'), y: num(el, 'y') })

function readGeo(g) {
  if (!g) return null
  const geo = {
    x: num(g, 'x'),
    y: num(g, 'y'),
    width: num(g, 'width'),
    height: num(g, 'height'),
    relative: g.getAttribute('relative') === '1',
    points: [],
  }
  for (const c of Array.from(g.children)) {
    const as = c.getAttribute('as')
    if (c.nodeName === 'mxPoint' && as) geo[as] = pt(c) // sourcePoint, targetPoint, offset
    else if (c.nodeName === 'Array' && as === 'points') geo.points = Array.from(c.children).map(pt)
  }
  return geo
}

function readCells(model) {
  const cells = new Map()
  const kids = new Map()
  for (const el of Array.from(model.getElementsByTagName('mxCell'))) {
    // Cells with custom properties are wrapped: <object id label …><mxCell …/></object>.
    const holder = el.hasAttribute('id') ? el : el.parentNode
    const raw = parseStyle(el.getAttribute('style'))
    const edge = el.getAttribute('edge') === '1'
    const cell = {
      id: holder.getAttribute('id'),
      parent: el.getAttribute('parent'),
      value: holder === el ? el.getAttribute('value') : holder.getAttribute('label'),
      vertex: el.getAttribute('vertex') === '1',
      edge,
      source: el.getAttribute('source'),
      target: el.getAttribute('target'),
      hidden: el.getAttribute('visible') === '0',
      style: { ...(edge ? EDGE_DEFAULTS : VERTEX_DEFAULTS), ...NAMED[raw.base], ...raw },
      geo: readGeo(Array.from(el.children).find((c) => c.nodeName === 'mxGeometry')),
    }
    cell.shape = cell.style.shape || cell.style.base || 'rectangle'
    cells.set(cell.id, cell)
    if (!kids.has(cell.parent)) kids.set(cell.parent, [])
    kids.get(cell.parent).push(cell)
  }
  return { cells, kids }
}

/* ---------------- style ---------------- */

// `missing` when unset, null for 'none', `dflt` for draw.io's theme 'default'.
function paint(v, missing, dflt = missing) {
  if (v == null || v === '') return missing
  if (v === 'none') return null
  if (v === 'default') return dflt
  const ld = /^light-dark\(\s*([^,]+),/.exec(v)
  return ld ? ld[1].trim() : v
}

const pct = (v) => (v == null ? 1 : Math.min(1, Math.max(0, parseFloat(v) / 100)))

function dashOf(st, sw) {
  if (st.dashed !== '1') return null
  const pattern = (st.dashPattern || '3 3').split(/\s+/).map(Number)
  return pattern.map((n) => (st.fixDash === '1' ? n : n * sw)).join(' ')
}

const GRADIENT_ANGLE = { east: 0, south: 90, west: 180, north: 270 }

function shapeStyle(st, doc) {
  const sw = parseFloat(st.strokeWidth) || 1
  let fill = paint(st.fillColor, '#ffffff')
  const to = paint(st.gradientColor, null, '#ffffff')
  if (fill && to) {
    const id = genId('grad')
    doc.defs.gradients[id] = {
      id,
      type: st.gradientDirection === 'radial' ? 'radial' : 'linear',
      angle: GRADIENT_ANGLE[st.gradientDirection] ?? 90,
      stops: [
        { offset: 0, color: fill, opacity: 1 },
        { offset: 1, color: to, opacity: 1 },
      ],
    }
    fill = `url(#${id})`
  }
  return {
    fill,
    fillOpacity: pct(st.fillOpacity),
    stroke: paint(st.strokeColor, '#000000'),
    strokeWidth: sw,
    strokeOpacity: pct(st.strokeOpacity),
    opacity: pct(st.opacity),
    dash: dashOf(st, sw),
  }
}

/* ---------------- labels ---------------- */

function labelText(value, st) {
  if (!value) return ''
  if (st.html !== '1') return value
  const html = value
    .replace(/<br\s*\/?>\s*(?=<\/(div|p)>)/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<(div|p|li)\b[^>]*>/gi, '\n')
  const text = new DOMParser().parseFromString(html, 'text/html').body.textContent
  return text.replace(/ /g, ' ').replace(/^\n+|\n+$/g, '')
}

// Greedy word wrap to the label box, as draw.io does for whiteSpace=wrap.
function wrap(node, maxWidth) {
  node.text = textLines(node)
    .map((line) => {
      const out = []
      let cur = ''
      for (const word of line.split(' ')) {
        const next = cur ? `${cur} ${word}` : word
        if (cur && lineWidth(node, next) > maxWidth) {
          out.push(cur)
          cur = word
        } else cur = next
      }
      out.push(cur)
      return out.join('\n')
    })
    .join('\n')
}

const nameOf = (text, fallback) => (text ? text.split('\n')[0].slice(0, 40) : fallback)

/** The label as a text object (plus its background box), laid out in `box`. */
function labelNodes(value, st, box, rotation = 0) {
  const text = labelText(value, st)
  if (!text || st.noLabel === '1') return []
  let { x, y, width: w, height: h } = box
  if (st.labelPosition === 'left') x -= w
  else if (st.labelPosition === 'right') x += w
  if (st.verticalLabelPosition === 'top') y -= h
  else if (st.verticalLabelPosition === 'bottom') y += h

  const fs = parseInt(st.fontStyle, 10) || 0
  const align = { left: 'start', right: 'end' }[st.align] || 'middle'
  const pad = parseFloat(st.spacing ?? 2)
  const node = createText({
    name: nameOf(text),
    text,
    fontFamily: st.fontFamily || 'Helvetica',
    fontSize: parseFloat(st.fontSize) || 12,
    fontWeight: fs & 1 ? 700 : 400,
    fontStyle: fs & 2 ? 'italic' : 'normal',
    align,
    lineHeight: 1.2,
    rotation,
    style: { fill: paint(st.fontColor, '#000000'), stroke: null },
  })
  if (st.whiteSpace === 'wrap' && w > 2 * pad) wrap(node, w - 2 * pad)

  node.x = align === 'start' ? x + pad : align === 'end' ? x + w - pad : x + w / 2
  const blockH = textLines(node).length * lineStep(node)
  const top =
    st.verticalAlign === 'top' ? y + pad : st.verticalAlign === 'bottom' ? y + h - pad - blockH : y + (h - blockH) / 2
  node.y = top + firstBaselineOffset(node)

  const bg = paint(st.labelBackgroundColor, null, '#ffffff')
  const border = paint(st.labelBorderColor, null, '#000000')
  if (!bg && !border) return [node]
  const b = geometryBBox(node)
  const back = createRect({
    name: 'Label background',
    x: b.x - 2,
    y: b.y,
    width: b.width + 4,
    height: b.height,
    rotation,
    style: { fill: bg, stroke: border },
  })
  return [back, node]
}

/* ---------------- vertices ---------------- */

function shapeNode(cell, box, doc) {
  const st = cell.style
  const style = shapeStyle(st, doc)
  if (!style.fill && !style.stroke) return null
  const { x, y, width: w, height: h } = box
  const cx = x + w / 2
  const cy = y + h / 2
  const common = { style, rotation: parseFloat(st.rotation) || 0, flipX: st.flipH === '1', flipY: st.flipV === '1' }
  switch (cell.shape) {
    case 'ellipse':
    case 'doubleEllipse':
      return createEllipse({ ...common, cx, cy, rx: w / 2, ry: h / 2 })
    case 'rhombus':
      return createPolygon({ ...common, name: 'Rhombus', points: [[cx, y], [x + w, cy], [cx, y + h], [x, cy]] })
    case 'triangle': {
      const pts = {
        north: [[x, y + h], [cx, y], [x + w, y + h]],
        south: [[x, y], [x + w, y], [cx, y + h]],
        west: [[x + w, y], [x, cy], [x + w, y + h]],
      }[st.direction] || [[x, y], [x + w, cy], [x, y + h]]
      return createPolygon({ ...common, name: 'Triangle', points: pts })
    }
    case 'hexagon': {
      const s = w * (parseFloat(st.size) || 0.25)
      const pts = [[x + s, y], [x + w - s, y], [x + w, cy], [x + w - s, y + h], [x + s, y + h], [x, cy]]
      return createPolygon({ ...common, name: 'Hexagon', points: pts })
    }
    case 'line':
      return createPath({ ...common, name: 'Line', d: `M ${x} ${cy} L ${x + w} ${cy}`, style: { ...style, fill: null } })
    case 'image': {
      // A data URI in a style drops its `;base64` — the `;` is the style separator.
      const href = (st.image || '').replace(/^data:([^,;]+),/, 'data:$1;base64,')
      return href ? createImage({ ...common, x, y, width: w, height: h, href, style: {} }) : null
    }
    default: {
      const arc = parseFloat(st.arcSize)
      const rx = st.rounded !== '1' ? 0 : st.absoluteArcSize === '1' ? (arc || 10) / 2 : (Math.min(w, h) * (arc || 15)) / 100
      return createRect({ ...common, x, y, width: w, height: h, rx })
    }
  }
}

function vertexNodes(cell, box, doc) {
  const st = cell.style
  const out = []
  const shape = shapeNode(cell, box, doc)
  if (shape) out.push(shape)
  let labelBox = box
  if (cell.shape === 'swimlane') {
    const head = parseFloat(st.startSize) || 23
    labelBox = { ...box, height: head }
    if (shape) out.push(createPath({ name: 'Header', d: `M ${box.x} ${box.y + head} L ${box.x + box.width} ${box.y + head}`, style: { ...shape.style, fill: null } }))
  }
  out.push(...labelNodes(cell.value, st, labelBox, parseFloat(st.rotation) || 0))
  return out
}

/* ---------------- edges ---------------- */

const center = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 })

// Where a line from the shape's centre toward `toward` crosses its outline.
function perimeter(box, toward) {
  const rx = box.width / 2
  const ry = box.height / 2
  const c = center(box)
  const dx = toward.x - c.x
  const dy = toward.y - c.y
  const k =
    box.kind === 'ellipse'
      ? 1 / Math.hypot(dx / rx, dy / ry)
      : box.kind === 'rhombus'
        ? 1 / (Math.abs(dx) / rx + Math.abs(dy) / ry)
        : Math.min(rx / Math.abs(dx), ry / Math.abs(dy))
  const f = k < 1 ? k : 1
  return { x: c.x + dx * f, y: c.y + dy * f }
}

// A fixed connection point (exitX/exitY, entryX/entryY), as fractions of the box.
function fixedPoint(box, fx, fy) {
  if (fx == null || fy == null) return null
  return { x: box.x + parseFloat(fx) * box.width, y: box.y + parseFloat(fy) * box.height }
}

// ponytail: one elbow pair per bend-less leg along its longer axis — draw.io's
// router also avoids shapes and honours port directions.
function orthogonal(pts) {
  const out = [pts[0]]
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    if (a.x !== b.x && a.y !== b.y) {
      if (Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)) {
        const mx = (a.x + b.x) / 2
        out.push({ x: mx, y: a.y }, { x: mx, y: b.y })
      } else {
        const my = (a.y + b.y) / 2
        out.push({ x: a.x, y: my }, { x: b.x, y: my })
      }
    }
    out.push(b)
  }
  return out
}

function pointAlong(pts, f) {
  const lens = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y))
  let d = lens.reduce((s, l) => s + l, 0) * f
  for (let i = 0; i < lens.length; i++) {
    if (d <= lens[i] || i === lens.length - 1) {
      const t = lens[i] ? Math.min(d / lens[i], 1) : 0
      return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * t, y: pts[i].y + (pts[i + 1].y - pts[i].y) * t }
    }
    d -= lens[i]
  }
  return pts[0]
}

const ARROW_SIZE = 6

// ponytail: 'open' is a chevron, every other marker (diamond, oval, ER…) a
// classic triangle.
function arrowHead(tip, from, type, size, filled, style) {
  const len = Math.hypot(tip.x - from.x, tip.y - from.y) || 1
  const ux = (tip.x - from.x) / len
  const uy = (tip.y - from.y) / len
  const L = size + style.strokeWidth
  const at = (along, across) => [tip.x - ux * along - uy * across, tip.y - uy * along + ux * across]
  const [l, r] = [at(L, L / 2), at(L, -L / 2)]
  const head = { stroke: style.stroke, strokeWidth: style.strokeWidth, opacity: style.opacity, strokeOpacity: style.strokeOpacity }
  if (type === 'open') {
    return {
      node: createPath({ name: 'Arrow', d: `M ${l[0]} ${l[1]} L ${tip.x} ${tip.y} L ${r[0]} ${r[1]}`, style: { ...head, fill: null } }),
      back: 0,
    }
  }
  const points = type.startsWith('classic') ? [[tip.x, tip.y], l, at((L * 3) / 4, 0), r] : [[tip.x, tip.y], l, r]
  return {
    node: createPolygon({ name: 'Arrow', points, style: { ...head, fill: filled ? style.stroke : null } }),
    back: filled ? L / 2 : L,
  }
}

function shorten(p, from, by) {
  const len = Math.hypot(p.x - from.x, p.y - from.y)
  if (!by || len <= by) return p
  return { x: p.x + ((from.x - p.x) * by) / len, y: p.y + ((from.y - p.y) * by) / len }
}

function edgeNodes(cell, ctx) {
  const { boxOf, originOf, kids, doc } = ctx
  const st = cell.style
  const g = cell.geo || { points: [] }
  const o = originOf(cell.parent)
  const shift = (p) => p && { x: p.x + o.x, y: p.y + o.y }
  const src = cell.source && boxOf(cell.source)
  const tgt = cell.target && boxOf(cell.target)
  const exit = src && fixedPoint(src, st.exitX, st.exitY)
  const entry = tgt && fixedPoint(tgt, st.entryX, st.entryY)
  const start = exit || (src ? center(src) : shift(g.sourcePoint))
  const end = entry || (tgt ? center(tgt) : shift(g.targetPoint))
  if (!start || !end) return []

  let pts = [start, ...g.points.map(shift), end]
  if (/orthogonal|elbow|entityRelation/i.test(st.edgeStyle || '')) pts = orthogonal(pts)
  const n = pts.length - 1
  if (src && !exit) pts[0] = perimeter(src, pts[1])
  if (tgt && !entry) pts[n] = perimeter(tgt, pts[n - 1])

  const style = { ...shapeStyle({ ...st, fillColor: 'none', gradientColor: 'none' }, doc), fill: null }
  const size = (k) => parseFloat(st[k]) || ARROW_SIZE
  const out = []
  const line = [...pts]
  for (const [side, tip, from, filled] of [
    ['end', n, n - 1, st.endFill !== '0'],
    ['start', 0, 1, st.startFill !== '0'],
  ]) {
    const type = st[`${side}Arrow`]
    if (!type || type === 'none') continue
    const head = arrowHead(pts[tip], pts[from], type, size(`${side}Size`), filled, style)
    out.push(head.node)
    line[tip] = shorten(pts[tip], pts[from], head.back)
  }
  const d = line.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ')
  out.unshift(createPath({ name: 'Line', d, style }))

  // The edge's own label, then any label cells hung on it; both sit at a
  // fraction along the line (geometry x, -1…1) plus an offset.
  const labelAt = (geo) => {
    const p = pointAlong(pts, ((geo?.relative ? geo.x : 0) + 1) / 2)
    const off = geo?.offset || { x: 0, y: 0 }
    return { x: p.x + off.x, y: p.y + off.y, width: 0, height: 0 }
  }
  out.push(...labelNodes(cell.value, st, labelAt(g)))
  for (const k of kids.get(cell.id) || []) {
    if (k.vertex && !k.hidden) out.push(...labelNodes(k.value, k.style, labelAt(k.geo)))
  }
  return out
}

/* ---------------- structure ---------------- */

// Several nodes become one group, so a shape and its label move together.
function put(doc, nodes, parentId, name, flags) {
  if (!nodes.length) return
  const top = nodes.length === 1 ? nodes[0] : createGroup({ name })
  Object.assign(top, flags)
  addNode(doc, top, parentId)
  if (top !== nodes[0]) for (const n of nodes) addNode(doc, n, top.id)
}

// Layers, pages and containers that end up holding nothing aren't worth a row.
function dropIfEmpty(doc, g) {
  if (g.children.length) return
  delete doc.nodes[g.id]
  const list = g.parent ? doc.nodes[g.parent].children : doc.rootOrder
  list.splice(list.indexOf(g.id), 1)
}

function convertPage(model, doc, pageGroupId) {
  const { cells, kids } = readCells(model)

  const boxes = new Map()
  const boxOf = (id) => {
    if (boxes.has(id)) return boxes.get(id)
    const c = cells.get(id)
    let box = null
    if (c && c.vertex && c.geo) {
      const g = c.geo
      const p = boxOf(c.parent)
      const off = g.offset || { x: 0, y: 0 }
      // Relative geometry inside a shape is a fraction of it (ports and the like).
      box =
        g.relative && p
          ? { x: p.x + g.x * p.width + off.x, y: p.y + g.y * p.height + off.y }
          : { x: (p ? p.x : 0) + g.x, y: (p ? p.y : 0) + g.y }
      Object.assign(box, { width: g.width, height: g.height, kind: c.shape })
    }
    boxes.set(id, box)
    return box
  }
  const originOf = (id) => boxOf(id) || { x: 0, y: 0 }
  const ctx = { boxOf, originOf, kids, doc }

  const convertChildren = (parentId, groupId) => {
    for (const cell of kids.get(parentId) || []) {
      const flags = { hidden: cell.hidden, locked: cell.style.locked === '1' }
      const name = nameOf(labelText(cell.value, cell.style), cell.edge ? 'Connector' : cell.shape)
      if (cell.edge) {
        put(doc, edgeNodes(cell, ctx), groupId, name, flags)
        continue
      }
      const box = cell.vertex && boxOf(cell.id)
      if (!box) continue
      const nodes = vertexNodes(cell, box, doc)
      const children = (kids.get(cell.id) || []).filter((k) => k.vertex || k.edge)
      if (!children.length) {
        put(doc, nodes, groupId, name, flags)
        continue
      }
      // A container or group: its own shape at the back, its contents on top.
      const g = createGroup({ name, ...flags })
      addNode(doc, g, groupId)
      for (const n of nodes) addNode(doc, n, g.id)
      convertChildren(cell.id, g.id)
      dropIfEmpty(doc, g)
    }
  }

  const root = [...cells.values()].find((c) => !c.parent)
  const layers = root ? kids.get(root.id) || [] : []
  for (const layer of layers) {
    let target = pageGroupId
    if (layers.length > 1) {
      const g = createGroup({ name: layer.value || 'Layer', hidden: layer.hidden, locked: layer.style.locked === '1' })
      addNode(doc, g, pageGroupId)
      target = g.id
    }
    convertChildren(layer.id, target)
    if (target !== pageGroupId) dropIfEmpty(doc, doc.nodes[target])
  }
}

/**
 * A document holding every page of a draw.io diagram: one group per page
 * (when there are several) stacked top to bottom, one group per layer (when a
 * page has several), and the page sized to fit.
 */
export async function drawioToDocument(xml) {
  const pages = await readPages(xml)
  const doc = createDocument()
  let y = MARGIN
  let width = 0
  for (const page of pages) {
    const before = doc.rootOrder.length
    let pageGroup = null
    if (pages.length > 1) {
      pageGroup = createGroup({ name: page.name })
      addNode(doc, pageGroup, null)
    }
    convertPage(page.model, doc, pageGroup?.id ?? null)
    if (pageGroup) dropIfEmpty(doc, pageGroup)
    const bg = paint(page.model.getAttribute('background'), null)
    if (bg && !doc.background) doc.background = bg

    const ids = doc.rootOrder.slice(before)
    const b = unionBBox(ids.map((id) => nodeBounds(doc.nodes[id], doc.nodes)))
    if (!b) continue
    for (const id of ids) translateNode(doc.nodes[id], MARGIN - b.x, y - b.y, doc.nodes)
    y += b.height + PAGE_GAP
    width = Math.max(width, b.width)
  }
  if (!width) throw new Error('This draw.io diagram has nothing on it to import.')
  doc.page = { width: Math.ceil(width + 2 * MARGIN), height: Math.ceil(y - PAGE_GAP + MARGIN) }
  return doc
}
