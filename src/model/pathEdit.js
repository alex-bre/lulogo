// Editable representation of an SVG path for point-level editing.
//
// A path `d` string is parsed into an array of subpaths, each:
//   { closed, anchors: [{ x, y, hIn, hOut }] }
// where an anchor's point is (x, y) and hIn / hOut are the absolute cubic
// control points of the incoming / outgoing segment (null for straight lines) —
// the same anchor shape the pen tool uses. This lets us move points, drag bezier
// handles, split a segment to add a point, and remove points, then serialize
// back to a clean `d` via anchorsToPath.

import { anchorsToPath } from './pen'

const ARGS = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 }
const tokenize = (d) => (d || '').match(/[a-zA-Z]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) || []
const isCmd = (t) => /[a-zA-Z]/.test(t)
const EPS = 0.01

const coincident = (a, b) => Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS

/** Parse a `d` string into editable subpaths. Q/T are converted to cubics; arcs
 * are approximated by a line to their endpoint (our own paths never use arcs). */
export function parsePath(d) {
  const tokens = tokenize(d)
  const subs = []
  let cur = null
  let cx = 0
  let cy = 0
  let startX = 0
  let startY = 0
  let prevC2 = null // last cubic 2nd control (absolute), for S
  let prevQ = null // last quad control (absolute), for T
  let i = 0

  const push = (x, y, hIn) => cur.anchors.push({ x, y, hIn: hIn || null, hOut: null })
  const setPrevOut = (h) => {
    if (cur && cur.anchors.length) cur.anchors[cur.anchors.length - 1].hOut = h
  }
  const finishSub = () => {
    if (!cur) return
    // A closed subpath that ends with an explicit segment back to the start
    // carries a duplicate anchor; fold its incoming handle onto the first point.
    if (cur.closed && cur.anchors.length > 1) {
      const first = cur.anchors[0]
      const last = cur.anchors[cur.anchors.length - 1]
      if (coincident(first, last)) {
        first.hIn = last.hIn
        cur.anchors.pop()
      }
    }
    if (cur.anchors.length) subs.push(cur)
    cur = null
  }

  while (i < tokens.length) {
    const cmd = tokens[i++]
    const lower = cmd.toLowerCase()
    const rel = cmd === lower
    if (lower === 'z') {
      if (cur) cur.closed = true
      cx = startX
      cy = startY
      prevC2 = prevQ = null
      finishSub()
      continue
    }
    const n = ARGS[lower]
    if (n === undefined) continue
    let first = true
    do {
      const args = []
      for (let k = 0; k < n; k++) args.push(parseFloat(tokens[i++]))
      const op = lower === 'm' && !first ? 'l' : lower
      switch (op) {
        case 'm': {
          finishSub()
          let [x, y] = args
          if (rel) {
            x += cx
            y += cy
          }
          cur = { closed: false, anchors: [{ x, y, hIn: null, hOut: null }] }
          cx = x
          cy = y
          startX = x
          startY = y
          prevC2 = prevQ = null
          break
        }
        case 'l': {
          let [x, y] = args
          if (rel) {
            x += cx
            y += cy
          }
          push(x, y, null)
          cx = x
          cy = y
          prevC2 = prevQ = null
          break
        }
        case 'h': {
          const x = rel ? cx + args[0] : args[0]
          push(x, cy, null)
          cx = x
          prevC2 = prevQ = null
          break
        }
        case 'v': {
          const y = rel ? cy + args[0] : args[0]
          push(cx, y, null)
          cy = y
          prevC2 = prevQ = null
          break
        }
        case 'c':
        case 's': {
          let x1, y1, x2, y2, x, y
          if (op === 'c') {
            ;[x1, y1, x2, y2, x, y] = args
            if (rel) {
              x1 += cx
              y1 += cy
              x2 += cx
              y2 += cy
              x += cx
              y += cy
            }
          } else {
            ;[x2, y2, x, y] = args
            if (rel) {
              x2 += cx
              y2 += cy
              x += cx
              y += cy
            }
            x1 = prevC2 ? 2 * cx - prevC2.x : cx
            y1 = prevC2 ? 2 * cy - prevC2.y : cy
          }
          setPrevOut({ x: x1, y: y1 })
          push(x, y, { x: x2, y: y2 })
          prevC2 = { x: x2, y: y2 }
          prevQ = null
          cx = x
          cy = y
          break
        }
        case 'q':
        case 't': {
          let qx, qy, x, y
          if (op === 'q') {
            ;[qx, qy, x, y] = args
            if (rel) {
              qx += cx
              qy += cy
              x += cx
              y += cy
            }
          } else {
            ;[x, y] = args
            if (rel) {
              x += cx
              y += cy
            }
            qx = prevQ ? 2 * cx - prevQ.x : cx
            qy = prevQ ? 2 * cy - prevQ.y : cy
          }
          // Quadratic → cubic: raise degree so the editor only deals with cubics.
          setPrevOut({ x: cx + (2 / 3) * (qx - cx), y: cy + (2 / 3) * (qy - cy) })
          push(x, y, { x: x + (2 / 3) * (qx - x), y: y + (2 / 3) * (qy - y) })
          prevQ = { x: qx, y: qy }
          prevC2 = null
          cx = x
          cy = y
          break
        }
        case 'a': {
          let [, , , , , x, y] = args
          if (rel) {
            x += cx
            y += cy
          }
          push(x, y, null)
          cx = x
          cy = y
          prevC2 = prevQ = null
          break
        }
        default:
          break
      }
      first = false
    } while (i < tokens.length && !isCmd(tokens[i]))
  }
  finishSub()
  return subs
}

/** Serialize editable subpaths back to a `d` string. */
export function serializeSubpaths(subs) {
  return subs
    .map((sp) => anchorsToPath(sp.anchors, sp.closed))
    .filter(Boolean)
    .join(' ')
}

const cloneAnchor = (a) => ({
  x: a.x,
  y: a.y,
  hIn: a.hIn ? { ...a.hIn } : null,
  hOut: a.hOut ? { ...a.hOut } : null,
})
const cloneSub = (s) => ({ closed: s.closed, anchors: s.anchors.map(cloneAnchor) })
const cloneSubs = (subs) => subs.map(cloneSub)

const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })

/** Point on a cubic bezier at parameter t. */
export function cubicPoint(p0, c1, c2, p1, t) {
  const mt = 1 - t
  const a = mt * mt * mt
  const b = 3 * mt * mt * t
  const c = 3 * mt * t * t
  const d = t * t * t
  return {
    x: a * p0.x + b * c1.x + c * c2.x + d * p1.x,
    y: a * p0.y + b * c1.y + c * c2.y + d * p1.y,
  }
}

function nearestTCubic(p0, c1, c2, p1, pt) {
  let best = 0.5
  let bestD = Infinity
  for (let i = 0; i <= 24; i++) {
    const t = i / 24
    const q = cubicPoint(p0, c1, c2, p1, t)
    const dd = (q.x - pt.x) ** 2 + (q.y - pt.y) ** 2
    if (dd < bestD) {
      bestD = dd
      best = t
    }
  }
  return best
}

function nearestTLine(p0, p1, pt) {
  const vx = p1.x - p0.x
  const vy = p1.y - p0.y
  const len = vx * vx + vy * vy
  if (!len) return 0.5
  const t = ((pt.x - p0.x) * vx + (pt.y - p0.y) * vy) / len
  return Math.max(0.05, Math.min(0.95, t))
}

/**
 * Insert a point on the segment leaving anchor `ai` of subpath `sp`, at the
 * position nearest `point` (or its `.t` if given). Splits a cubic exactly via de
 * Casteljau (curve shape is preserved). Returns { subs, sp, ai } with `ai` the
 * index of the new anchor.
 */
export function insertAnchor(subs, sp, ai, point) {
  const next = cloneSubs(subs)
  const s = next[sp]
  if (!s) return { subs: next, sp, ai }
  const len = s.anchors.length
  const p0 = s.anchors[ai]
  const p1 = s.anchors[(ai + 1) % len]
  const cubic = !!(p0.hOut || p1.hIn)
  let mid
  if (cubic) {
    const c1 = p0.hOut || { x: p0.x, y: p0.y }
    const c2 = p1.hIn || { x: p1.x, y: p1.y }
    const t = point && point.t != null ? point.t : nearestTCubic(p0, c1, c2, p1, point)
    const a = lerp(p0, c1, t)
    const b = lerp(c1, c2, t)
    const c = lerp(c2, p1, t)
    const d = lerp(a, b, t)
    const e = lerp(b, c, t)
    const f = lerp(d, e, t)
    p0.hOut = a
    p1.hIn = c
    mid = { x: f.x, y: f.y, hIn: d, hOut: e }
  } else {
    const t = point && point.t != null ? point.t : nearestTLine(p0, p1, point)
    const m = lerp(p0, p1, t)
    mid = { x: m.x, y: m.y, hIn: null, hOut: null }
  }
  const at = ai + 1
  s.anchors.splice(at, 0, mid)
  return { subs: next, sp, ai: at }
}

/**
 * Remove anchor `ai` from subpath `sp`. A subpath left with fewer than 2 anchors
 * is dropped entirely. Returns the new subpaths array.
 */
export function deleteAnchor(subs, sp, ai) {
  const next = cloneSubs(subs)
  const s = next[sp]
  if (!s) return next
  s.anchors.splice(ai, 1)
  if (s.anchors.length < 2) next.splice(sp, 1)
  return next
}
