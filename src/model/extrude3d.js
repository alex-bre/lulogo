// 3D "thickness" effect for the 3D transform: extrude a shape's outline from
// z=0 (the artwork plane / front face) to z=depth, and turn the resulting solid
// into a back-to-front ordered list of flat faces — front cap, side walls, back
// cap — each already projected to 2D by the shared makeProjector. Side/back
// faces are auto-shaded from the fill so the block reads as solid (e.g. a
// rotated rounded-rect becomes a tablet). Pure and synchronous.

import { parsePath, cubicPoint } from './pathEdit'

const r3 = (n) => Math.round(n * 1000) / 1000

/* ---------------- colour helpers ---------------- */

function parseHex(c) {
  if (typeof c !== 'string') return null
  let s = c.trim()
  if (s[0] !== '#') return null
  s = s.slice(1)
  if (s.length === 3) s = s.split('').map((ch) => ch + ch).join('')
  if (s.length !== 6) return null
  const n = parseInt(s, 16)
  return Number.isNaN(n) ? null : [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const toHex = (rgb) => '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')

// The body colour to shade the walls/back from: the node's solid fill, or a
// neutral grey when the fill is a gradient, "none", or otherwise not a colour.
export function bodyBase(style) {
  return parseHex(style && style.fill) || [150, 150, 150]
}

const shade = (rgb, f) => rgb.map((v) => v * f)

/* ---------------- convex hull (simplified mode) ---------------- */

// Andrew's monotone-chain convex hull of 2D points → boundary vertices in
// order. Simplified extrusion uses it to get the block's whole screen
// silhouette as a single polygon (the hull of the front + offset-back outline).
function convexHull(points) {
  const pts = points.map((p) => [p[0], p[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const dedup = []
  for (const p of pts) {
    const last = dedup[dedup.length - 1]
    if (!last || last[0] !== p[0] || last[1] !== p[1]) dedup.push(p)
  }
  if (dedup.length < 3) return dedup
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const half = (src) => {
    const h = []
    for (const p of src) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop()
      h.push(p)
    }
    h.pop() // drop the endpoint — it opens the next chain
    return h
  }
  return half(dedup).concat(half([...dedup].reverse()))
}

/* ---------------- outline flattening ---------------- */

function subpathPoints(anchors, closed, steps) {
  const A = anchors
  const n = A.length
  if (!n) return []
  const pts = [[A[0].x, A[0].y]]
  const segs = closed ? n : n - 1
  for (let i = 0; i < segs; i++) {
    const a = A[i]
    const b = A[(i + 1) % n]
    if (!a.hOut && !b.hIn) {
      pts.push([b.x, b.y]) // straight edge
    } else {
      const c1 = a.hOut || { x: a.x, y: a.y }
      const c2 = b.hIn || { x: b.x, y: b.y }
      for (let s = 1; s <= steps; s++) {
        const q = cubicPoint({ x: a.x, y: a.y }, c1, c2, { x: b.x, y: b.y }, s / steps)
        pts.push([q.x, q.y])
      }
    }
  }
  if (closed && pts.length > 1) {
    const f = pts[0]
    const l = pts[pts.length - 1]
    if (Math.hypot(f[0] - l[0], f[1] - l[1]) < 1e-6) pts.pop()
  }
  return pts
}

/** Flatten a projectable source (see transform3d.nodeSource) into subpaths of
 *  boundary points: [{ closed, pts: [[x,y], ...] }]. */
export function outlineSubpaths(src, steps = 12) {
  if (!src) return []
  if (src.kind === 'points') return [{ closed: src.closed !== false, pts: src.points.map((p) => [p[0], p[1]]) }]
  if (src.kind === 'line') return [{ closed: false, pts: [[src.x1, src.y1], [src.x2, src.y2]] }]
  if (src.kind === 'd') {
    return parsePath(src.d)
      .map((sp) => ({ closed: sp.closed, pts: subpathPoints(sp.anchors, sp.closed, steps) }))
      .filter((s) => s.pts.length >= 2)
  }
  return []
}

/* ---------------- extrusion ---------------- */

// Light travel direction in view space (from upper-left-front). A face is lit
// in proportion to how much its outward normal opposes this.
const LIGHT = [0.35, 0.55, 0.75]
// The single tone used for the whole block in flat ("simple") mode.
const FLAT_FACTOR = 0.72

/**
 * Extrude `src` by `depth` (page units, toward +z / behind the front face) and
 * return the visible faces ordered back-to-front, ready to paint:
 *   [{ role: 'front'|'side'|'back', d, fill }]
 * `fill` is null for the front cap (the caller paints it with the node's own
 * style); side/back faces carry a solid body colour. Hidden (back-facing) faces
 * are culled. Returns [] when depth is 0 or the source is empty.
 *
 * opts.flat: when true, every side/back face gets one uniform colour (a single
 * darkened shade of the fill) instead of per-face directional shading.
 * opts.simple: convex shortcut — instead of a wall per outline edge, return a
 * single body face whose outline is the screen-space convex hull of the front
 * and offset-back outlines (implies flat shading). Two faces total however
 * round the shape; correct for convex outlines (concavities get filled in).
 * opts.steps: curve-flattening resolution.
 */
export function extrudeFaces(src, projector, depth, style, opts = {}) {
  const { flat = false, simple = false, steps = 12, taper = 0 } = opts
  const subs = outlineSubpaths(src, steps)
  if (!subs.length || !depth) return []
  const base = bodyBase(style)
  const { cx, cy } = projector

  // Taper: the back cross-section shrinks toward the shape's centre as it
  // recedes. sBack is the back scale (1 = straight prism → 0 = pointed). Scaling
  // is about the whole outline's bbox centre so holes stay concentric.
  const sBack = Math.max(0.02, Math.min(1, 1 - taper))
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const sp of subs) {
    for (const p of sp.pts) {
      if (p[0] < minX) minX = p[0]
      if (p[0] > maxX) maxX = p[0]
      if (p[1] < minY) minY = p[1]
      if (p[1] > maxY) maxY = p[1]
    }
  }
  const ctr = [(minX + maxX) / 2, (minY + maxY) / 2]
  const backXY = (p) => [ctr[0] + (p[0] - ctr[0]) * sBack, ctr[1] + (p[1] - ctr[1]) * sBack]
  const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

  // Rotate a direction into view space (makeProjector.rotate translates by the
  // pivot first, so offsetting from the pivot recovers M · n).
  const rotDir = (n) => {
    const q = projector.rotate(cx + n[0], cy + n[1], n[2])
    const len = Math.hypot(q.x, q.y, q.z) || 1
    return [q.x / len, q.y / len, q.z / len]
  }
  const flatFill = toHex(shade(base, FLAT_FACTOR))
  // Directional shade for a face normal, or the single flat tone in simple mode.
  const faceFill = (rn, mul = 1) => {
    if (flat) return flatFill
    const nd = Math.max(0, -(rn[0] * LIGHT[0] + rn[1] * LIGHT[1] + rn[2] * LIGHT[2]))
    const f = Math.max(0.32, Math.min(0.85, 0.42 + 0.34 * nd)) // always < 1 → darker than the front
    return toHex(shade(base, f * mul))
  }
  const projFace = (corners) => {
    let d = ''
    for (let i = 0; i < corners.length; i++) {
      const p = projector.pt(corners[i][0], corners[i][1], corners[i][2])
      d += `${i ? 'L' : 'M'} ${r3(p[0])} ${r3(p[1])} `
    }
    return d + 'Z'
  }
  const avgZ = (corners) => {
    let z = 0
    for (const c of corners) z += projector.rotate(c[0], c[1], c[2]).z
    return z / corners.length
  }

  // Path data for the visible cap(s): each closed subpath, projected at plane
  // `z` (optionally pushed toward the centre by `xf` for the tapered back).
  const capD = (z, xf, subsClosed) =>
    subsClosed
      .map((sp) => {
        let d = ''
        sp.pts.forEach((p, i) => {
          const c = xf ? xf(p) : p
          const q = projector.pt(c[0], c[1], z)
          d += `${i ? 'L' : 'M'} ${r3(q[0])} ${r3(q[1])} `
        })
        return d + 'Z'
      })
      .join(' ')

  // Simplified ("convex") mode: skip the per-edge walls entirely. The block's
  // whole screen silhouette is the convex hull of the projected front outline
  // (z=0) and the offset-back outline (z=depth); fill that with the single flat
  // body tone and lay the viewer-facing cap on top — two paths, however round
  // the shape. Only correct for convex outlines (holes/concavities fill in).
  if (simple) {
    const hullPts = []
    for (const sp of subs) {
      for (const p of sp.pts) {
        const f = projector.pt(p[0], p[1], 0)
        hullPts.push([f[0], f[1]])
        const b = backXY(p)
        const q = projector.pt(b[0], b[1], depth)
        hullPts.push([q[0], q[1]])
      }
    }
    const hull = convexHull(hullPts)
    const out = []
    if (hull.length >= 3) {
      let d = ''
      hull.forEach((p, i) => {
        d += `${i ? 'L' : 'M'} ${r3(p[0])} ${r3(p[1])} `
      })
      out.push({ role: 'side', d: d + 'Z', z: 0, fill: flatFill }) // body, painted first (behind)
    }
    const closedSubs = subs.filter((s) => s.closed)
    if (closedSubs.length) {
      // Exactly one of the two caps faces the viewer (unless edge-on): the front
      // keeps the object's own style; a visible back reads as the flat body tone.
      if (rotDir([0, 0, -1])[2] < 0) out.push({ role: 'front', d: capD(0, null, closedSubs), z: 1, fill: null })
      else if (rotDir([0, 0, 1])[2] < 0) out.push({ role: 'back', d: capD(depth, backXY, closedSubs), z: 1, fill: flatFill })
    }
    return out
  }

  const faces = []

  // Side walls: one quad per outline edge, kept only when it faces the viewer.
  // With taper the back edge is pulled toward the centre, so each wall is a
  // trapezoid whose true normal (from the 3D quad) tilts — hence the cross
  // product rather than a flat xy perpendicular.
  for (const sp of subs) {
    const P = sp.pts
    const m = P.length
    let sx = 0
    let sy = 0
    for (const p of P) {
      sx += p[0]
      sy += p[1]
    }
    const C = [sx / m, sy / m] // subpath centre — orients normals outward (holes too)
    const edges = sp.closed ? m : m - 1
    for (let i = 0; i < edges; i++) {
      const a0 = P[i]
      const a1 = P[(i + 1) % m]
      const b0 = backXY(a0)
      const b1 = backXY(a1)
      const corners = [
        [a0[0], a0[1], 0],
        [a1[0], a1[1], 0],
        [b1[0], b1[1], depth],
        [b0[0], b0[1], depth],
      ]
      const e1 = [corners[1][0] - corners[0][0], corners[1][1] - corners[0][1], 0]
      const e2 = [corners[3][0] - corners[0][0], corners[3][1] - corners[0][1], depth]
      let n = cross3(e1, e2)
      const midToC = [(a0[0] + a1[0]) / 2 - C[0], (a0[1] + a1[1]) / 2 - C[1]]
      if (midToC[0] * n[0] + midToC[1] * n[1] < 0) n = [-n[0], -n[1], -n[2]] // point outward
      const rn = rotDir(n)
      if (rn[2] >= 0) continue // back-facing — hidden inside the solid
      faces.push({ role: 'side', d: projFace(corners), z: avgZ(corners), fill: faceFill(rn) })
    }
  }

  // Caps (only closed subpaths enclose an area). Even-odd across subpaths so
  // holes are respected. Whichever cap faces the viewer is kept.
  const closed = subs.filter((s) => s.closed)
  if (closed.length) {
    const capCorners = (z, xf) => closed.flatMap((sp) => sp.pts.map((p) => (xf ? [...xf(p), z] : [p[0], p[1], z])))

    const frn = rotDir([0, 0, -1])
    if (frn[2] < 0) faces.push({ role: 'front', d: capD(0, null, closed), z: avgZ(capCorners(0)), fill: null })

    // The back cap stays parallel to the front (normal ±z), just shrunk by taper.
    const brn = rotDir([0, 0, 1])
    if (brn[2] < 0) faces.push({ role: 'back', d: capD(depth, backXY, closed), z: avgZ(capCorners(depth, backXY)), fill: faceFill(brn, 0.9) })
  }

  // Paint walls first (far→near among themselves), then the visible cap last:
  // a wall shares its rim edge with the cap and only recedes from there, so the
  // visible cap always sits in front of every wall (a pure centroid sort can
  // wrongly float a near wall over the cap).
  faces.sort((a, b) => {
    const la = a.role === 'side' ? 0 : 1
    const lb = b.role === 'side' ? 0 : 1
    return la !== lb ? la - lb : b.z - a.z
  })
  return faces
}
