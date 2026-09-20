import { getPaper } from '../geometry/paperBridge'
import { rasterizeImageIntersection } from '../geometry/imageMask'
import { genId } from '../model/nodes'
import { transformPathData } from '../model/pathTransform'

// Import an SVG string into our node model using Paper.js, which parses the SVG
// and bakes all transforms. Basic shapes are expanded to paths (geometry kept
// exact); <text> stays text; raster images stay images. Gradient fills/strokes
// are converted to document gradients (see gradientFromColor). Returns
// { nodes, gradients } — plain nodes plus a map of gradient defs to upsert.
//
// Clipping is baked at import time (this model has no clip primitive): every
// leaf under a `clip-path`ed group is intersected with the clip region —
// shapes are cut geometrically, raster images are re-rasterised through the
// clip (see imageMask.js). Nested clips intersect. A shape-only `<mask>`
// (white, fully opaque — the shape Figma/Sketch/Illustrator emit for a plain
// rectangular or vector frame) is treated as a clip too; see maskToClip.

// Item's accumulated transform (local geometry → global page coords).
const matrixArr = (m) => [m.a, m.b, m.c, m.d, m.tx, m.ty]
const IDENTITY = [1, 0, 0, 1, 0, 0]
// Paper emits path data with relative commands; the rest of the model (pathBBox,
// pathEdit, serialize) assumes absolute. transformPathData rewrites to absolute,
// so run every Paper-produced `d` through it even when no transform is needed.
const absPathData = (d) => transformPathData(d, IDENTITY)
const applyM = (m, p) => ({ x: m.a * p.x + m.c * p.y + m.tx, y: m.b * p.x + m.d * p.y + m.ty })

// Convert a Paper.js gradient Color into our simplified gradient model
// (objectBoundingBox stops; linear direction encoded as an angle in
// bbox-normalized space to match Defs' `rotate(angle 0.5 0.5)` rendering).
// Returns a gradient def object or null if it can't be represented.
function gradientFromColor(color, m, bounds) {
  const g = color && color.gradient
  if (!g || !g.stops || g.stops.length < 2) return null
  const stops = g.stops
    .map((st, i, arr) => {
      let off = st.offset
      if (off == null) off = arr.length > 1 ? i / (arr.length - 1) : 0
      return {
        offset: Math.min(1, Math.max(0, off)),
        color: st.color ? st.color.toCSS(true) : '#000000',
        opacity: st.color && st.color.alpha != null ? st.color.alpha : 1,
      }
    })
    .sort((a, b) => a.offset - b.offset)
  const id = genId('grad')
  if (g.radial) return { id, type: 'radial', angle: 0, stops }
  // Linear: angle from origin→destination, measured in bbox-normalized space so
  // it lines up with our objectBoundingBox gradient (default vector is L→R).
  const o = color.origin
  const d = color.destination
  if (!o || !d) return { id, type: 'linear', angle: 0, stops }
  const go = applyM(m, o)
  const gd = applyM(m, d)
  const w = bounds && bounds.width ? bounds.width : 1
  const h = bounds && bounds.height ? bounds.height : 1
  const dx = (gd.x - go.x) / w
  const dy = (gd.y - go.y) / h
  const angle = Math.round((Math.atan2(dy, dx) * 180) / Math.PI)
  return { id, type: 'linear', angle, stops }
}

// Resolve a Paper.js paint (fill/stroke) to a CSS color or a `url(#id)`
// gradient reference, registering any gradient into `gradients`.
function paintFromColor(color, item, m, gradients) {
  if (!color) return null
  if (color.type === 'gradient') {
    const grad = gradientFromColor(color, m, item.bounds)
    if (grad) {
      gradients[grad.id] = grad
      return `url(#${grad.id})`
    }
    // Degenerate gradient → fall back to its first stop color.
    const s0 = color.gradient && color.gradient.stops && color.gradient.stops[0]
    return s0 && s0.color ? s0.color.toCSS(true) : null
  }
  return color.toCSS(true)
}

// `override` (optional) is paint from a <use>, applied only to <symbol>-expanded
// content: the glyph shapes in a Cairo/PDF-style text symbol carry no paint of
// their own (and a browser materialises the black SVG default onto them), so the
// <use>'s colour — not the glyph's — is authoritative. It is undefined for every
// ordinary element, which therefore keeps its own paint exactly as before.
function styleFromItem(item, m, gradients, override) {
  const fill = (override && override.fill) || item.fillColor || null
  const stroke = (override && override.stroke) || item.strokeColor || null
  return {
    fill: paintFromColor(fill, item, m, gradients),
    fillOpacity: 1,
    stroke: paintFromColor(stroke, item, m, gradients),
    strokeWidth: (override && override.strokeWidth) || item.strokeWidth || 1,
    strokeOpacity: 1,
    opacity: item.opacity != null ? item.opacity : 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    dash: null,
  }
}

function baseNode() {
  return { id: genId('imp'), parent: null, rotation: 0, flipX: false, flipY: false, locked: false, hidden: false }
}

function itemToNode(item, gradients, override) {
  const cn = item.className
  const m = item.globalMatrix
  if (cn === 'Path' || cn === 'CompoundPath') {
    // Bake ancestor/group/viewBox transforms into the path data so geometry
    // (and its bounding box) is correct in page coordinates.
    const d = transformPathData(item.pathData, matrixArr(m))
    return d ? { ...baseNode(), type: 'path', name: 'Path', d, style: styleFromItem(item, m, gradients, override) } : null
  }
  if (cn === 'PointText') {
    const p = item.point
    const x = m.a * p.x + m.c * p.y + m.tx
    const y = m.b * p.x + m.d * p.y + m.ty
    const scale = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1
    return {
      ...baseNode(),
      type: 'text',
      name: 'Text',
      x,
      y,
      text: item.content || '',
      fontFamily: item.fontFamily || 'sans-serif',
      fontSize: (item.fontSize || 16) * scale,
      fontWeight: item.fontWeight || 400,
      fontStyle: 'normal',
      align: item.justification === 'center' ? 'middle' : item.justification === 'right' ? 'end' : 'start',
      style: styleFromItem(item, m, gradients, override),
    }
  }
  if (cn === 'Raster') {
    // item.bounds is already in global/project coordinates.
    const b = item.bounds
    let href
    try {
      href = item.toDataURL()
    } catch {
      href = item.source
    }
    return { ...baseNode(), type: 'image', name: 'Image', x: b.x, y: b.y, width: b.width, height: b.height, href, style: {} }
  }
  return null
}

// --- clipping -------------------------------------------------------------

// Build a CompoundPath operand for a boolean op, dropping the degenerate
// single-point subpaths Cairo/Inkscape leave behind (`M x y` repeated right
// after `Z`). Feeding those to Paper's boolean ops makes it facet curved
// outlines into straight segments and sometimes drop pieces entirely.
function operand(paper, d) {
  const cp = new paper.CompoundPath(d)
  for (const c of (cp.children || []).slice()) {
    if (!c.segments || c.segments.length < 2) c.remove()
  }
  return cp
}

// Smallest distance from `point` to the outline of a (possibly compound) path.
function nearestDist(shape, point) {
  const parts = shape.children && shape.children.length ? shape.children : [shape]
  let best = Infinity
  for (const p of parts) {
    if (!p.getNearestPoint) continue
    const np = p.getNearestPoint(point)
    if (np) best = Math.min(best, point.getDistance(np))
  }
  return best
}

// True when `clip` lies essentially inside `shape` — every vertex is inside, or
// close enough to the boundary to be a coincident edge. Cairo emits its art as
// a big container rectangle clipped to the real (rounded) outline, and the two
// edges often coincide; running the boolean then shaves the curve into facets,
// so in this case we return the clip outline untouched instead.
function clipWithinShape(shape, clip) {
  const b = shape.bounds
  const eps = Math.max(0.75, (b.width + b.height) * 0.005)
  const subs = clip.children && clip.children.length ? clip.children : [clip]
  let pts = 0
  for (const sp of subs) {
    if (!sp.segments) continue
    for (const seg of sp.segments) {
      pts += 1
      if (shape.contains(seg.point)) continue
      if (nearestDist(shape, seg.point) <= eps) continue
      return false
    }
  }
  return pts >= 3
}

// A Paper clip item → its outline as SVG path data in global page coordinates.
// A <clipPath> with several shapes clips to their union (SVG semantics), so a
// Group clip is unioned here. `expandShapes` means a real source clip always
// arrives as Path/CompoundPath; a bare Shape clip mask is Paper's own
// viewport/overflow clip (handled — and skipped — in collect()).
function clipItemToData(paper, item) {
  const cn = item.className
  if (cn === 'Path' || cn === 'CompoundPath') {
    return transformPathData(item.pathData, matrixArr(item.globalMatrix)) || null
  }
  if (cn === 'Group' || cn === 'Layer') {
    let acc = null
    for (const child of item.children) {
      const d = clipItemToData(paper, child)
      if (!d) continue
      const cp = operand(paper, d)
      acc = acc ? acc.unite(cp) : cp
    }
    return acc && acc.pathData ? absPathData(acc.pathData) : null
  }
  return null
}

// Intersect two clip regions (either may be null = "no clip on this axis").
// Returns null when the regions don't overlap at all.
function intersectClip(paper, aData, bData) {
  if (!aData) return bData || null
  if (!bData) return aData || null
  const a = operand(paper, aData)
  const b = operand(paper, bData)
  // Identical (or nested) region → skip the boolean, which would only facet it.
  if (clipWithinShape(a, b)) return absPathData(b.pathData)
  if (clipWithinShape(b, a)) return absPathData(a.pathData)
  const r = a.intersect(b)
  return r && r.pathData ? absPathData(r.pathData) : null
}

// Bake `clipData` (global-space path outline) into a freshly built node.
// Returns the node (possibly rewritten), or null when it falls entirely
// outside the clip. Text can't be cut without outlining it, so it passes
// through unclipped.
async function clipNode(paper, node, clipData) {
  if (!clipData) return node
  if (node.type === 'path') {
    const np = operand(paper, node.d)
    const cp = operand(paper, clipData)
    // The clip is the real (often rounded) outline and the shape just contains
    // it — return the clip verbatim so its curves survive intact.
    if (clipWithinShape(np, cp)) return { ...node, d: absPathData(cp.pathData) }
    const r = np.intersect(cp)
    const d = r && r.pathData ? absPathData(r.pathData) : null
    return d ? { ...node, d } : null
  }
  if (node.type === 'image') {
    const rect = new paper.Path.Rectangle(new paper.Rectangle(node.x, node.y, node.width, node.height))
    const region = rect.intersect(operand(paper, clipData))
    const b = region && region.bounds
    if (!b || b.width <= 0 || b.height <= 0) return null
    const raster = await rasterizeImageIntersection(node, absPathData(region.pathData), {
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
    })
    if (!raster) return node
    return { ...node, href: raster.href, x: b.x, y: b.y, width: raster.width, height: raster.height }
  }
  return node
}

async function collect(item, out, gradients, paper, clipData, override, seenClips) {
  const cn = item.className
  seenClips = seenClips || new Set()
  if (cn === 'Group' || cn === 'Layer') {
    const children = item.children.slice()
    let childClip = clipData
    let childSeen = seenClips
    // Paper folds `clip-path` into a group whose leading child is the clip mask.
    while (children.length && children[0].clipMask) {
      const mask = children.shift()
      // A bare Shape clip mask is Paper clipping the <svg> viewport / overflow,
      // not a clip from the source — art is imported onto an infinite canvas,
      // not the source's page box, so drop it.
      if (mask.className === 'Shape') continue
      const maskData = clipItemToData(paper, mask)
      if (!maskData) continue
      // Cairo/Inkscape emits every clip twice (on the outer <g> and again on an
      // inner <g>). Re-intersecting a region with an identical outline is a
      // mathematical no-op but Paper's boolean op on coincident edges is
      // numerically unstable and chews curved outlines into faceted ones — so
      // fold each distinct clip in only once.
      if (childSeen.has(maskData)) continue
      childSeen = new Set(childSeen).add(maskData)
      const next = intersectClip(paper, childClip, maskData)
      // Non-overlapping clips → the whole subtree is masked away.
      if (!next && (childClip || maskData)) return
      childClip = next
    }
    for (const child of children) await collect(child, out, gradients, paper, childClip, override, childSeen)
    return
  }
  // <use> of a <symbol> (e.g. Cairo/Inkscape text: each glyph is a symbol). The
  // glyph geometry lives in the symbol definition and carries no paint of its
  // own — the fill comes from the <use> (or its ancestor <g>). Expand it: place
  // a clone of the definition where the <use> put it, recurse, and hand the
  // <use>'s resolved paint down as an override for the glyph shapes.
  if (cn === 'SymbolItem') {
    const def = item.definition || item.symbol
    const art = def && (def.item || def._item)
    if (!art) return
    const clone = art.clone({ insert: true, deep: true })
    clone.transform(item.globalMatrix)
    const paint = {
      fill: item.fillColor || (override && override.fill) || null,
      stroke: item.strokeColor || (override && override.stroke) || null,
      strokeWidth: item.strokeWidth || (override && override.strokeWidth) || null,
    }
    await collect(clone, out, gradients, paper, clipData, paint, seenClips)
    clone.remove()
    return
  }
  // A `clip-path` set straight on a basic shape makes Paper wrap it in a Group
  // *before* `expandShapes` runs, so the shape is never expanded — do it here.
  let leaf = item
  if (leaf.className === 'Shape') {
    const p = leaf.toPath(true)
    leaf.remove()
    leaf = p
  }
  const node = itemToNode(leaf, gradients, override)
  if (!node) return
  const clipped = await clipNode(paper, node, clipData)
  if (clipped) out.push(clipped)
}

// --- <mask> that is really a clip --------------------------------------------

const SHAPE_TAGS = new Set(['rect', 'circle', 'ellipse', 'path', 'polygon', 'polyline'])
const PAINT_ATTRS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'opacity', 'style']

function isOpaqueWhite(v) {
  if (v == null) return false
  const s = String(v).trim().toLowerCase()
  return (
    s === 'white' ||
    s === '#fff' ||
    s === '#ffffff' ||
    s === 'rgb(255,255,255)' ||
    s === 'rgb(255 255 255)' ||
    s === 'rgb(100%,100%,100%)'
  )
}

// True when every drawing element under `el` is a fully opaque, solid-white
// shape (optionally inside plain <g> wrappers) — i.e. the mask paints a flat
// region and nothing more, so it is equivalent to a clip path.
function isPlainClipMask(el) {
  let shapes = 0
  const walk = (parent) => {
    for (const child of Array.from(parent.children || [])) {
      const tag = child.tagName.toLowerCase()
      if (tag === 'g') {
        const op = child.getAttribute('opacity')
        if (op != null && parseFloat(op) < 1) return false
        if (!walk(child)) return false
        continue
      }
      if (!SHAPE_TAGS.has(tag)) return false
      if (!isOpaqueWhite(child.getAttribute('fill'))) return false
      const fo = child.getAttribute('fill-opacity')
      if (fo != null && parseFloat(fo) < 1) return false
      const op = child.getAttribute('opacity')
      if (op != null && parseFloat(op) < 1) return false
      const style = child.getAttribute('style')
      if (style && /(^|[;\s])(opacity|fill-opacity)\s*:/.test(style)) return false
      shapes += 1
    }
    return true
  }
  return walk(el) && shapes > 0
}

function stripPaint(el) {
  for (const a of PAINT_ATTRS) el.removeAttribute && el.removeAttribute(a)
  for (const child of Array.from(el.children || [])) stripPaint(child)
}

// Rewrite shape-only `<mask>` elements as `<clipPath>` so Paper.js (which has no
// <mask> support) applies them. Anything with partial opacity, a gradient, or a
// non-shape child is left untouched — it simply imports unmasked, as before.
function maskToClip(svgString) {
  if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') return svgString
  if (!/<\s*mask[\s>]/.test(svgString)) return svgString
  try {
    return maskToClipUnsafe(svgString)
  } catch {
    // Any surprise in the DOM round-trip: fall back to the original string —
    // the SVG then imports unmasked, exactly as it did before.
    return svgString
  }
}

function maskToClipUnsafe(svgString) {
  const doc = new DOMParser().parseFromString(svgString, 'image/svg+xml')
  if (!doc || !doc.documentElement) return svgString
  if (doc.getElementsByTagName('parsererror').length || doc.documentElement.nodeName === 'parsererror') {
    return svgString
  }

  const SVG_NS = 'http://www.w3.org/2000/svg'
  const masks = Array.from(doc.getElementsByTagName('mask'))
  if (!masks.length) return svgString

  const converted = new Set()
  for (const mask of masks) {
    const id = mask.getAttribute('id')
    if (!id || !isPlainClipMask(mask)) continue
    const clip = doc.createElementNS(SVG_NS, 'clipPath')
    clip.setAttribute('id', id)
    // A <clipPath> may only hold shapes — Paper.js drops any <g> (and its
    // transform) inside one — so flatten wrapper transforms onto each shape.
    const emit = (parent, xf) => {
      for (const child of Array.from(parent.children || [])) {
        const own = child.getAttribute('transform')
        const combined = own ? (xf ? `${xf} ${own}` : own) : xf
        if (child.tagName.toLowerCase() === 'g') {
          emit(child, combined)
          continue
        }
        if (!SHAPE_TAGS.has(child.tagName.toLowerCase())) continue
        const copy = child.cloneNode(true)
        stripPaint(copy)
        if (combined) copy.setAttribute('transform', combined)
        else copy.removeAttribute('transform')
        clip.appendChild(copy)
      }
    }
    emit(mask, mask.getAttribute('transform') || '')
    mask.parentNode.replaceChild(clip, mask)
    converted.add(id)
  }
  if (!converted.size) return svgString

  const ref = /url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/
  for (const el of Array.from(doc.getElementsByTagName('*'))) {
    const m = el.getAttribute && el.getAttribute('mask')
    if (!m) continue
    const hit = ref.exec(m)
    if (!hit || !converted.has(hit[1])) continue
    el.removeAttribute('mask')
    // Don't clobber a clip the element already carries; drop the mask instead.
    if (!el.getAttribute('clip-path')) el.setAttribute('clip-path', `url(#${hit[1]})`)
  }

  return new XMLSerializer().serializeToString(doc)
}

export async function importSvgToNodes(svgString) {
  const paper = await getPaper()
  const out = []
  const gradients = {}
  try {
    const root = paper.project.importSVG(maskToClip(svgString), { expandShapes: true })
    if (root) await collect(root, out, gradients, paper, null)
  } finally {
    paper.project.activeLayer.removeChildren()
  }
  return { nodes: out, gradients }
}
