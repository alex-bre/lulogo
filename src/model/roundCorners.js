// "Round corners": replace the sharp corners of a shape with tangent circular
// fillets of a given radius.
//
// The shape is taken apart into segments (lines and cubics). At every corner —
// an anchor where the incoming and outgoing tangents disagree — both adjacent
// segments are trimmed back by d = r / tan(theta / 2) (theta = the interior
// angle), and the gap is bridged by a cubic that approximates the circular arc
// of radius r touching both sides. Between two straight edges that is the exact
// rounded-rectangle corner; when a neighbouring segment is curved the fillet is
// still tangent to it (G1), it just isn't a perfect circle.
//
// Trims are clamped per segment so two neighbouring corners can never eat past
// each other: if they ask for more than the segment is long, both shrink
// proportionally. That makes any radius safe to apply — an oversized one simply
// rounds each corner as much as its edges allow.

import { parsePath, serializeSubpaths, cubicPoint } from './pathEdit'

// A corner is only rounded when its tangents break by more than this; anything
// smoother is already continuous and gets left alone.
const SMOOTH_TOL = (1 * Math.PI) / 180
const SAMPLES = 32 // arc-length samples per cubic
const EPS = 1e-9

const pt = (p) => ({ x: p.x, y: p.y })
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y })
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y })
const mul = (v, k) => ({ x: v.x * k, y: v.y * k })
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
const lerpP = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
const norm = (v) => {
  const l = Math.hypot(v.x, v.y)
  return l > EPS ? { x: v.x / l, y: v.y / l } : null
}

/* ---------------- segments ---------------- */

// Split an editable subpath into its segments. `c` marks a cubic; a line keeps
// only its endpoints.
function segmentsOf(sp) {
  const a = sp.anchors
  const n = a.length
  const count = sp.closed ? n : n - 1
  const segs = []
  for (let i = 0; i < count; i++) {
    const p0 = a[i]
    const p1 = a[(i + 1) % n]
    if (p0.hOut || p1.hIn) {
      segs.push({ c: true, p0: pt(p0), c1: pt(p0.hOut || p0), c2: pt(p1.hIn || p1), p1: pt(p1) })
    } else {
      segs.push({ c: false, p0: pt(p0), p1: pt(p1) })
    }
  }
  return segs
}

const tangentStart = (s) =>
  s.c ? norm(sub(s.c1, s.p0)) || norm(sub(s.c2, s.p0)) || norm(sub(s.p1, s.p0)) : norm(sub(s.p1, s.p0))
const tangentEnd = (s) =>
  s.c ? norm(sub(s.p1, s.c2)) || norm(sub(s.p1, s.c1)) || norm(sub(s.p1, s.p0)) : norm(sub(s.p1, s.p0))

// Cumulative chord lengths at t = i / SAMPLES — good enough to trim by, since
// the trim is a design amount, not a measurement.
function cumLengths(s) {
  const cum = [0]
  let prev = s.p0
  for (let i = 1; i <= SAMPLES; i++) {
    const p = cubicPoint(s.p0, s.c1, s.c2, s.p1, i / SAMPLES)
    cum.push(cum[i - 1] + dist(prev, p))
    prev = p
  }
  return cum
}

function segLength(s) {
  return s.c ? cumLengths(s)[SAMPLES] : dist(s.p0, s.p1)
}

function tAtLength(cum, len) {
  const total = cum[SAMPLES]
  if (len <= 0 || total <= EPS) return 0
  if (len >= total) return 1
  let i = 1
  while (i < SAMPLES && cum[i] < len) i++
  const span = cum[i] - cum[i - 1] || 1
  return (i - 1 + (len - cum[i - 1]) / span) / SAMPLES
}

function splitCubic(s, t) {
  const p01 = lerpP(s.p0, s.c1, t)
  const p12 = lerpP(s.c1, s.c2, t)
  const p23 = lerpP(s.c2, s.p1, t)
  const p012 = lerpP(p01, p12, t)
  const p123 = lerpP(p12, p23, t)
  const mid = lerpP(p012, p123, t)
  return [
    { c: true, p0: s.p0, c1: p01, c2: p012, p1: mid },
    { c: true, p0: mid, c1: p123, c2: p23, p1: s.p1 },
  ]
}

/** The piece of a segment left after cutting `dStart` off its head and `dEnd`
 * off its tail (both arc lengths). */
function trimSegment(s, dStart, dEnd) {
  if (dStart <= EPS && dEnd <= EPS) return s
  if (!s.c) {
    const u = norm(sub(s.p1, s.p0))
    if (!u) return s
    return { c: false, p0: add(s.p0, mul(u, dStart)), p1: sub(s.p1, mul(u, dEnd)) }
  }
  const cum = cumLengths(s)
  const total = cum[SAMPLES]
  const t0 = tAtLength(cum, dStart)
  const t1 = tAtLength(cum, total - dEnd)
  if (t1 - t0 < 1e-6) return s
  const right = t0 > 0 ? splitCubic(s, t0)[1] : s
  const tt = t0 > 0 ? (t1 - t0) / (1 - t0) : t1
  return tt < 1 ? splitCubic(right, tt)[0] : right
}

/* ---------------- the fillet ---------------- */

// Handle length for a cubic that approximates a circular arc turning by
// `delta` across a chord of length `chord`: k = 4/3 * tan(delta/4) * r with
// r = chord / (2 sin(delta/2)). Taking the radius from the actual chord keeps
// the fillet tangent to whatever the trimmed neighbours ended up being.
function filletHandle(chord, delta) {
  const s = Math.sin(delta / 2)
  if (chord <= EPS || delta <= 1e-6 || s <= EPS) return chord / 3
  return ((2 / 3) * chord * Math.tan(delta / 4)) / s
}

// Angle between two unit vectors, in [0, PI].
const turn = (a, b) => Math.atan2(Math.abs(a.x * b.y - a.y * b.x), a.x * b.x + a.y * b.y)

/**
 * Round the corners of one editable subpath. Returns a new subpath, or null if
 * it has no corner worth rounding.
 */
function roundSubpath(sp, radius) {
  const n = sp.anchors.length
  if (n < 3) return null
  const segs = segmentsOf(sp)
  if (segs.length < 2) return null

  // Wanted trim distance per corner (index = anchor index). Open subpaths keep
  // their two endpoints, which have only one segment each.
  const trim = new Array(n).fill(0)
  const first = sp.closed ? 0 : 1
  const last = sp.closed ? n - 1 : n - 2
  let any = false
  for (let i = first; i <= last; i++) {
    const inSeg = segs[(i - 1 + segs.length) % segs.length]
    const outSeg = segs[i]
    const uIn = tangentEnd(inSeg)
    const uOut = tangentStart(outSeg)
    if (!uIn || !uOut) continue
    const delta = turn(uIn, uOut)
    if (delta < SMOOTH_TOL) continue // already smooth here
    // theta is the interior angle; a near-cusp wants an unbounded trim, which
    // the clamp below turns into "as much as the edges allow".
    const theta = Math.PI - delta
    const d = radius / Math.tan(theta / 2)
    trim[i] = Number.isFinite(d) && d > 0 ? d : 1e6
    any = true
  }
  if (!any) return null

  // Neighbouring corners share a segment; when they want more of it than it
  // has they split it max-min fairly — a modest corner keeps all it asked for
  // and the greedy one takes the rest; two equally greedy ones meet in the
  // middle. Allowances only ever shrink, so a few passes settle the chain.
  const lens = segs.map(segLength)
  for (let pass = 0; pass < 6; pass++) {
    for (let j = 0; j < segs.length; j++) {
      const a = j
      const b = (j + 1) % n
      const max = lens[j] * 0.999
      if (trim[a] + trim[b] <= max) continue
      const half = max / 2
      if (trim[a] <= half) trim[b] = max - trim[a]
      else if (trim[b] <= half) trim[a] = max - trim[b]
      else trim[a] = trim[b] = half
    }
  }

  const cut = segs.map((s, j) => trimSegment(s, trim[j], trim[(j + 1) % n]))

  // Rebuild the anchors: a rounded corner becomes two anchors joined by the
  // fillet; an untouched one stays a single anchor.
  const anchors = []
  const inOf = (i) => (sp.closed ? cut[(i - 1 + cut.length) % cut.length] : i > 0 ? cut[i - 1] : null)
  const outOf = (i) => (sp.closed ? cut[i % cut.length] : i < cut.length ? cut[i] : null)
  for (let i = 0; i < n; i++) {
    const prev = inOf(i)
    const next = outOf(i)
    const hIn = prev && prev.c ? pt(prev.c2) : null
    const hOut = next && next.c ? pt(next.c1) : null
    if (trim[i] <= EPS || !prev || !next) {
      anchors.push({ x: next ? next.p0.x : prev.p1.x, y: next ? next.p0.y : prev.p1.y, hIn, hOut })
      continue
    }
    const A = pt(prev.p1)
    const B = pt(next.p0)
    const uIn = tangentEnd(prev)
    const uOut = tangentStart(next)
    if (!uIn || !uOut) {
      anchors.push({ x: B.x, y: B.y, hIn, hOut })
      continue
    }
    const k = filletHandle(dist(A, B), turn(uIn, uOut))
    anchors.push({ ...A, hIn, hOut: add(A, mul(uIn, k)) })
    anchors.push({ ...B, hIn: sub(B, mul(uOut, k)), hOut })
  }
  return { closed: sp.closed, anchors }
}

/* ---------------- public API ---------------- */

/**
 * Round every sharp corner in a path `d` with the given radius. Returns the new
 * path data, or null when there was nothing to round.
 */
export function roundPathData(d, radius) {
  if (!d || !(radius > 0)) return null
  const subs = parsePath(d)
  if (!subs.length) return null
  let changed = false
  const out = subs.map((sp) => {
    const r = roundSubpath(sp, radius)
    if (r) changed = true
    return r || sp
  })
  if (!changed) return null
  const next = serializeSubpaths(out)
  return next && next !== d ? next : null
}

/** Path data for a polygon node's points. */
export function polygonPathData(points, closed) {
  if (!points || points.length < 2) return ''
  return points.map((p, i) => `${i ? 'L' : 'M'} ${p[0]} ${p[1]}`).join(' ') + (closed ? ' Z' : '')
}

/** Node types whose corners can be rounded. */
export function canRoundCorners(node) {
  if (!node || node.locked) return false
  if (node.type === 'rect') return true
  if (node.type === 'polygon') return (node.points || []).length >= 3
  return node.type === 'path' && !!node.d
}

/**
 * Rounded version of a node, or null when nothing changes. A rect keeps its
 * type and just takes an `rx` (still a live, editable radius); a polygon or
 * path is baked into new path data — a polygon becomes a path, since rounded
 * corners can't be expressed as points.
 */
export function roundNodeCorners(node, radius) {
  if (!canRoundCorners(node) || !(radius > 0)) return null
  if (node.type === 'rect') {
    const max = Math.min(Math.abs(node.width), Math.abs(node.height)) / 2
    const rx = Math.min(radius, max)
    return rx === (node.rx || 0) ? null : { ...node, rx }
  }
  if (node.type === 'polygon') {
    const d = roundPathData(polygonPathData(node.points, node.closed !== false), radius)
    if (!d) return null
    const { points, closed, ...rest } = node
    return { ...rest, type: 'path', d }
  }
  const d = roundPathData(node.d, radius)
  return d ? { ...node, d } : null
}
