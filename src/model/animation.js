import { nodeBounds } from './bbox'

// Animation model + evaluation. The timeline lives in the document
// (document.animation) so clips undo/redo, autosave, and round-trip through
// project files like everything else. Playback is non-destructive: at a given
// time we compute per-node *overrides* ({ opacity, transform, d }) that the
// renderer layers on top of the base artwork — the document is never mutated
// while playing or scrubbing.
//
//   animation: {
//     duration: ms,                 // total timeline length
//     clips: [{ id, nodeId, effect, start, duration, easing, params }]
//   }

export const DEFAULT_DURATION = 5000
export const MIN_CLIP_MS = 100

let counter = 0
export function genClipId() {
  counter += 1
  return `clip_${Date.now().toString(36)}${counter.toString(36)}`
}

/** Read the document's animation, tolerating older documents without one. */
export function getAnimation(doc) {
  return doc.animation || { duration: DEFAULT_DURATION, clips: [] }
}

/** Make sure an immer draft document has an animation object; returns it. */
export function ensureAnimation(doc) {
  if (!doc.animation) doc.animation = { duration: DEFAULT_DURATION, clips: [] }
  return doc.animation
}

/* ---- easings ---- */

export const EASINGS = {
  linear: (t) => t,
  easeIn: (t) => t * t,
  easeOut: (t) => t * (2 - t),
  easeInOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
}

export const EASING_OPTIONS = [
  { value: 'easeInOut', label: 'Ease in-out' },
  { value: 'easeOut', label: 'Ease out' },
  { value: 'easeIn', label: 'Ease in' },
  { value: 'linear', label: 'Linear' },
]

/* ---- effect registry ---- */

// Each effect returns a contribution for one of three phases relative to its
// clip: 'before' (t < start), 'during' (eased progress p in 0..1), 'after'.
// Contributions: { opacity, dx, dy, scale, rotate, d } — all optional.
// "Enter" effects (fade/slide in) hide the node before their clip starts so a
// scrub from 0 shows the scene building up.

export const EFFECTS = {
  fadeIn: {
    label: 'Fade in',
    defaults: {},
    evaluate(phase, p) {
      if (phase === 'before') return { opacity: 0 }
      if (phase === 'during') return { opacity: p }
      return null
    },
  },
  fadeOut: {
    label: 'Fade out',
    defaults: {},
    evaluate(phase, p) {
      if (phase === 'during') return { opacity: 1 - p }
      if (phase === 'after') return { opacity: 0 }
      return null
    },
  },
  slideIn: {
    label: 'Slide in',
    defaults: { direction: 'left', distance: 240 },
    evaluate(phase, p, params) {
      const dist = params.distance ?? 240
      const v =
        params.direction === 'right'
          ? [dist, 0]
          : params.direction === 'up'
            ? [0, -dist]
            : params.direction === 'down'
              ? [0, dist]
              : [-dist, 0]
      if (phase === 'before') return { opacity: 0, dx: v[0], dy: v[1] }
      if (phase === 'during') return { opacity: Math.min(1, p * 3), dx: v[0] * (1 - p), dy: v[1] * (1 - p) }
      return null
    },
  },
  bounce: {
    label: 'Bounce',
    defaults: { height: 60, bounces: 3 },
    evaluate(phase, p, params) {
      if (phase !== 'during') return null
      const h = params.height ?? 60
      const n = Math.max(1, params.bounces ?? 3)
      // Decaying |sin| arcs: n hops that shrink to nothing by the clip's end.
      return { dy: -h * Math.abs(Math.sin(p * Math.PI * n)) * (1 - p) }
    },
  },
  pulse: {
    label: 'Pulse',
    defaults: { scale: 1.25, repeats: 2 },
    evaluate(phase, p, params) {
      if (phase !== 'during') return null
      const amp = (params.scale ?? 1.25) - 1
      const n = Math.max(1, params.repeats ?? 2)
      return { scale: 1 + amp * Math.abs(Math.sin(p * Math.PI * n)) }
    },
  },
  spin: {
    label: 'Spin',
    defaults: { turns: 1 },
    evaluate(phase, p, params) {
      if (phase === 'before') return null
      // Hold the final angle after the clip (whole turns land back on base).
      // Keeping the value continuous also lets the export interpolate keyframes
      // across the clip boundary without spinning backwards.
      return { rotate: 360 * (params.turns ?? 1) * (phase === 'after' ? 1 : p) }
    },
  },
  morph: {
    label: 'Morph',
    defaults: { targetId: null },
    evaluate(phase, p, params, node, nodes) {
      if (phase === 'before') return null
      const target = params.targetId ? nodes[params.targetId] : null
      const from = nodeToLocalD(node)
      const to = target && target.id !== node.id ? nodeToLocalD(target) : null
      if (!from || !to) return null
      const d = morphD(from, to, phase === 'after' ? 1 : p)
      return d ? { d } : null
    },
  },
}

export const EFFECT_OPTIONS = Object.entries(EFFECTS).map(([value, e]) => ({ value, label: e.label }))

/** Which node types can be a morph source/target. */
export function canMorph(node) {
  return !!node && (node.type === 'rect' || node.type === 'ellipse' || node.type === 'polygon' || node.type === 'path')
}

export function createClip(nodeId, effect, start = 0, duration = 1000) {
  return {
    id: genClipId(),
    nodeId,
    effect,
    start: Math.max(0, Math.round(start)),
    duration: Math.max(MIN_CLIP_MS, Math.round(duration)),
    easing: 'easeInOut',
    params: { ...(EFFECTS[effect] ? EFFECTS[effect].defaults : {}) },
  }
}

/* ---- evaluation ---- */

/** The document's clips grouped by (existing) node id, in clip order. */
export function clipsByNode(doc) {
  const map = new Map()
  for (const clip of getAnimation(doc).clips) {
    if (!doc.nodes[clip.nodeId] || !EFFECTS[clip.effect]) continue
    if (!map.has(clip.nodeId)) map.set(clip.nodeId, [])
    map.get(clip.nodeId).push(clip)
  }
  return map
}

/**
 * Combine one node's clips at `time` into raw components, or null when no clip
 * contributes. Opacity multiplies, offsets add, scales multiply, rotations add;
 * a morph `d` wins last. Shared by the live preview and the animated export so
 * both always agree.
 */
export function accumulateClipsAt(clips, node, nodes, time) {
  let a = null
  for (const clip of clips) {
    const fx = EFFECTS[clip.effect]
    if (!fx) continue

    let phase
    let p = 0
    if (time < clip.start) phase = 'before'
    else if (time < clip.start + clip.duration) {
      phase = 'during'
      const ease = EASINGS[clip.easing] || EASINGS.linear
      p = ease((time - clip.start) / clip.duration)
    } else phase = 'after'

    const c = fx.evaluate(phase, p, clip.params || {}, node, nodes)
    if (!c) continue

    if (!a) a = { opacity: 1, dx: 0, dy: 0, scale: 1, rotate: 0, d: null }
    if (c.opacity != null) a.opacity *= c.opacity
    if (c.dx) a.dx += c.dx
    if (c.dy) a.dy += c.dy
    if (c.scale != null) a.scale *= c.scale
    if (c.rotate) a.rotate += c.rotate
    if (c.d) a.d = c.d
  }
  return a
}

/**
 * Evaluate every clip at `time` (ms) and combine per node. Returns
 * { [nodeId]: { opacity?, transform?, d? } } or null when nothing applies.
 * Rotation/scale pivot on the node's rendered (world) center, so the
 * wrapper <g> composes correctly outside the node's own transform.
 */
export function evaluateAnimation(doc, time) {
  const byNode = clipsByNode(doc)
  if (!byNode.size) return null

  const out = {}
  for (const [id, clips] of byNode) {
    const a = accumulateClipsAt(clips, doc.nodes[id], doc.nodes, time)
    if (!a) continue
    const ov = {}
    if (a.opacity !== 1) ov.opacity = Math.max(0, Math.min(1, a.opacity))
    if (a.dx || a.dy || a.scale !== 1 || a.rotate) {
      const b = nodeBounds(doc.nodes[id], doc.nodes)
      const cx = b ? b.x + b.width / 2 : 0
      const cy = b ? b.y + b.height / 2 : 0
      const parts = []
      if (a.dx || a.dy) parts.push(`translate(${a.dx} ${a.dy})`)
      if (a.rotate) parts.push(`rotate(${a.rotate} ${cx} ${cy})`)
      if (a.scale !== 1) parts.push(`translate(${cx} ${cy}) scale(${a.scale}) translate(${-cx} ${-cy})`)
      ov.transform = parts.join(' ')
    }
    if (a.d) ov.d = a.d
    if (Object.keys(ov).length) out[id] = ov
  }
  return Object.keys(out).length ? out : null
}

/* ---- morph geometry ---- */

/** A node's outline as path data in its own (local, page-coordinate) space. */
export function nodeToLocalD(node) {
  if (!node) return null
  switch (node.type) {
    case 'rect': {
      const { x, y, width: w, height: h } = node
      const r = Math.min(node.rx || 0, w / 2, h / 2)
      if (!r) return `M ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h} L ${x} ${y + h} Z`
      return (
        `M ${x + r} ${y} L ${x + w - r} ${y} A ${r} ${r} 0 0 1 ${x + w} ${y + r} ` +
        `L ${x + w} ${y + h - r} A ${r} ${r} 0 0 1 ${x + w - r} ${y + h} ` +
        `L ${x + r} ${y + h} A ${r} ${r} 0 0 1 ${x} ${y + h - r} ` +
        `L ${x} ${y + r} A ${r} ${r} 0 0 1 ${x + r} ${y} Z`
      )
    }
    case 'ellipse': {
      const { cx, cy, rx, ry } = node
      return `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`
    }
    case 'polygon': {
      if (!node.points.length) return null
      const [h, ...rest] = node.points
      return `M ${h[0]} ${h[1]} ` + rest.map(([x, y]) => `L ${x} ${y}`).join(' ') + (node.closed ? ' Z' : '')
    }
    case 'path':
      return node.d || null
    default:
      return null
  }
}

// Sample N evenly-spaced points along a path via a hidden SVG element (same
// trick as pathBBox). Returns null where no layout engine exists (jsdom) so
// morphing quietly no-ops in tests.
const SVG_NS = 'http://www.w3.org/2000/svg'
let sampleEl = null
function ensureSampleEl() {
  if (sampleEl) return
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('width', '0')
  svg.setAttribute('height', '0')
  svg.style.position = 'absolute'
  svg.style.left = '-99999px'
  svg.style.visibility = 'hidden'
  sampleEl = document.createElementNS(SVG_NS, 'path')
  svg.appendChild(sampleEl)
  document.body.appendChild(svg)
}

const sampleCache = new Map()
const SAMPLES = 64

function samplePath(d) {
  const hit = sampleCache.get(d)
  if (hit !== undefined) return hit
  let pts = null
  try {
    if (typeof document !== 'undefined' && document.body) {
      ensureSampleEl()
      sampleEl.setAttribute('d', d)
      const len = sampleEl.getTotalLength()
      if (len > 0) {
        pts = []
        for (let i = 0; i < SAMPLES; i++) {
          const pt = sampleEl.getPointAtLength((len * i) / SAMPLES)
          pts.push([pt.x, pt.y])
        }
      }
    }
  } catch {
    pts = null
  }
  if (sampleCache.size > 500) sampleCache.clear()
  sampleCache.set(d, pts)
  return pts
}

function ptsBBox(pts) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of pts) {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  return { x: minX, y: minY, width: maxX - minX || 1, height: maxY - minY || 1 }
}

const pairCache = new Map()

// Prepared morph pair: source points + target points normalized into the
// source's bbox (a morph changes *shape*, it doesn't jump to the target's
// location) and rotated to the start index that minimizes travel.
function preparePair(fromD, toD) {
  const key = fromD + ' ' + toD
  const hit = pairCache.get(key)
  if (hit !== undefined) return hit

  let pair = null
  const a = samplePath(fromD)
  const b = samplePath(toD)
  if (a && b) {
    const ba = ptsBBox(a)
    const bb = ptsBBox(b)
    const norm = b.map(([x, y]) => [
      ba.x + ((x - bb.x) / bb.width) * ba.width,
      ba.y + ((y - bb.y) / bb.height) * ba.height,
    ])
    // Best cyclic offset (and direction) so corresponding points are close.
    let best = 0
    let bestRev = false
    let bestCost = Infinity
    for (const rev of [false, true]) {
      const cand = rev ? [...norm].reverse() : norm
      for (let off = 0; off < SAMPLES; off++) {
        let cost = 0
        for (let i = 0; i < SAMPLES; i += 4) {
          const q = cand[(i + off) % SAMPLES]
          cost += (a[i][0] - q[0]) ** 2 + (a[i][1] - q[1]) ** 2
        }
        if (cost < bestCost) {
          bestCost = cost
          best = off
          bestRev = rev
        }
      }
    }
    const ordered = bestRev ? [...norm].reverse() : norm
    const to = []
    for (let i = 0; i < SAMPLES; i++) to.push(ordered[(i + best) % SAMPLES])
    pair = { from: a, to }
  }
  if (pairCache.size > 100) pairCache.clear()
  pairCache.set(key, pair)
  return pair
}

const r2 = (n) => Math.round(n * 100) / 100

/** Interpolated outline between two path `d` strings at progress p (0..1). */
export function morphD(fromD, toD, p) {
  const pair = preparePair(fromD, toD)
  if (!pair) return null
  const pts = pair.from.map(([x, y], i) => [r2(x + (pair.to[i][0] - x) * p), r2(y + (pair.to[i][1] - y) * p)])
  return `M ${pts[0][0]} ${pts[0][1]} ` + pts.slice(1).map(([x, y]) => `L ${x} ${y}`).join(' ') + ' Z'
}
