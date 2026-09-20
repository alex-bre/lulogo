// 3D plane rotation + projection math for the "3D transform" feature.
//
// The artwork lives in the z=0 plane. Points are rotated about the selection
// center with M = Rx(rx) · Ry(ry) · Rz(rz) (Z applied first, like nested CSS
// rotations, so X reads as a screen-space tilt) and then projected back to 2D:
//
//  - orthographic: drop z (an affine map — exact for Bézier control points)
//  - perspective : scale by d / (d + z) with the viewer at z = -d
//
// Sign conventions follow SVG (y down, rz matches the 2D rotation attribute;
// +rx tips the bottom edge away, +ry tips the right edge away). Everything in
// this module is pure and synchronous.

export const T3D_DEFAULTS = {
  projection: 'orthographic', // 'orthographic' | 'perspective'
  rx: 0,
  ry: 0,
  rz: 0, // degrees
  perspective: 50, // 0..100 convergence strength (perspective only)
  depth: 0, // extrusion thickness in page units (0 = flat; >0 = a solid block)
  flatShade: false, // true = one flat colour for the block instead of per-face shading
  simple: false, // true = one convex body layer instead of per-edge walls (implies flatShade)
  taper: 0, // 0..1 how much the back shrinks toward the centre (0 = straight sides)
}

// Classic isometric faces (edges at ±30°, foreshortening √(2/3) ≈ 0.8165).
// 54.7356° = arccos(tan 30°), 35.2644° = arcsin(tan 30°).
export const ISO_PRESETS = {
  top: { rx: -54.7356, ry: 0, rz: 45 },
  left: { rx: 35.2644, ry: -45, rz: 0 },
  right: { rx: 35.2644, ry: 45, rz: 0 },
}

/** Wrap an angle to (-180, 180]. */
export function wrapAngle(a) {
  const w = ((a + 180) % 360 + 360) % 360 - 180
  return w === -180 ? 180 : w
}

export function isIdentityT3D(params) {
  return !wrapAngle(params.rx) && !wrapAngle(params.ry) && !wrapAngle(params.rz)
}

const rad = (deg) => (deg * Math.PI) / 180

/** Row-major 3×3 rotation matrix M = Rx · Ry · Rz. */
export function rotationMatrix(rxDeg, ryDeg, rzDeg) {
  const ax = rad(rxDeg)
  const ay = rad(ryDeg)
  const az = rad(rzDeg)
  const cx = Math.cos(ax)
  const sx = Math.sin(ax)
  const cy = Math.cos(ay)
  const sy = Math.sin(ay)
  const cz = Math.cos(az)
  const sz = Math.sin(az)
  // Rz: x' = x·cz - y·sz, y' = x·sz + y·cz          (matches SVG rotate())
  // Ry: x' = x·cy - z·sy, z' = x·sy + z·cy          (+ry sends +x away)
  // Rx: y' = y·cx - z·sx, z' = y·sx + z·cx          (+rx sends +y away)
  return [
    cy * cz, -cy * sz, -sy,
    cx * sz - sx * sy * cz, cx * cz + sx * sy * sz, -sx * cy,
    cx * sy * cz + sx * sz, sx * cz - cx * sy * sz, cx * cy,
  ]
}

/**
 * On-screen (dx, dy) offset for moving `distance` page units along a 3D
 * direction — the depth axis (0,0,1) aimed by tilt (about X) and turn (about Y),
 * then projected in parallel (drop z). Spin about the view axis doesn't change
 * this axis, so it takes no rz. At tilt=turn=0 the move points straight into the
 * screen and the on-screen offset is (0,0); tilting/turning swings it into view,
 * foreshortened by how much still points into depth.
 */
export function move3DDelta(distance, tiltDeg, turnDeg) {
  const m = rotationMatrix(tiltDeg, turnDeg, 0)
  return [distance * m[2], distance * m[5]] // x,y of M·(0,0,1)
}

/**
 * Camera distance for a 0..100 strength over a selection of diagonal `diag`.
 * The plane's half-diagonal is 0.5·diag, so d ≥ 0.75·diag guarantees no point
 * can rotate behind the viewer.
 */
export function perspectiveDistance(strength, diag) {
  const t = (100 - Math.min(100, Math.max(0, strength))) / 100
  return diag * (0.75 + 10 * t * t)
}

/**
 * Build the projector for a parameter set over the selection bounds `box`.
 * Returns:
 *  - pt(x, y, z=0)     → [X, Y] projected page point
 *  - rotate(x, y, z=0) → rotated point in centered coords (for face culling)
 *  - distance          → camera distance (null when orthographic)
 *  - subdivEps         → size threshold for curve subdivision
 */
export function makeProjector(params, box) {
  const m = rotationMatrix(params.rx, params.ry, params.rz)
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  const diag = Math.hypot(box.width, box.height) || 1
  const persp = params.projection === 'perspective'
  const d = persp ? perspectiveDistance(params.perspective ?? T3D_DEFAULTS.perspective, diag) : null

  const rotate = (x, y, z = 0) => {
    const px = x - cx
    const py = y - cy
    return {
      x: m[0] * px + m[1] * py + m[2] * z,
      y: m[3] * px + m[4] * py + m[5] * z,
      z: m[6] * px + m[7] * py + m[8] * z,
    }
  }

  const pt = (x, y, z = 0) => {
    const q = rotate(x, y, z)
    if (!persp) return [cx + q.x, cy + q.y]
    const s = d / Math.max(d + q.z, d * 0.06) // clamp: never explode near the eye
    return [cx + q.x * s, cy + q.y * s]
  }

  return { pt, rotate, distance: d, perspective: persp, cx, cy, subdivEps: diag / 64 }
}

/* ---------------- path data projection ---------------- */

const TOKEN = /[a-zA-Z]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g
const ARGS = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 }
const isCmd = (t) => /[a-zA-Z]/.test(t)
const fmt = (n) => Math.round(n * 1000) / 1000

/** Convert one SVG arc segment to cubic Béziers (SVG spec F.6.5). */
function arcToCubics(x1, y1, rx, ry, phiDeg, largeArc, sweep, x2, y2) {
  if (!rx || !ry || (x1 === x2 && y1 === y2)) return [[x1, y1, x2, y2, x2, y2]]
  rx = Math.abs(rx)
  ry = Math.abs(ry)
  const phi = rad(phiDeg)
  const cosP = Math.cos(phi)
  const sinP = Math.sin(phi)
  // to center parameterization
  const dx = (x1 - x2) / 2
  const dy = (y1 - y2) / 2
  const x1p = cosP * dx + sinP * dy
  const y1p = -sinP * dx + cosP * dy
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
  if (lam > 1) {
    const s = Math.sqrt(lam)
    rx *= s
    ry *= s
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p
  let coef = Math.sqrt(Math.max(0, num / den))
  if (largeArc === sweep) coef = -coef
  const cxp = (coef * rx * y1p) / ry
  const cyp = (-coef * ry * x1p) / rx
  const ccx = cosP * cxp - sinP * cyp + (x1 + x2) / 2
  const ccy = sinP * cxp + cosP * cyp + (y1 + y2) / 2
  const angle = (ux, uy, vx, vy) => {
    const sign = ux * vy - uy * vx < 0 ? -1 : 1
    const dot = ux * vx + uy * vy
    return sign * Math.acos(Math.min(1, Math.max(-1, dot / (Math.hypot(ux, uy) * Math.hypot(vx, vy)))))
  }
  const th1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
  let dth = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
  if (!sweep && dth > 0) dth -= 2 * Math.PI
  if (sweep && dth < 0) dth += 2 * Math.PI

  const segs = Math.max(1, Math.ceil(Math.abs(dth) / (Math.PI / 2)))
  const delta = dth / segs
  const alpha = ((4 / 3) * Math.tan(delta / 4))
  const out = []
  let th = th1
  const point = (t) => {
    const cosT = Math.cos(t)
    const sinT = Math.sin(t)
    return [
      ccx + rx * cosP * cosT - ry * sinP * sinT,
      ccy + rx * sinP * cosT + ry * cosP * sinT,
    ]
  }
  const deriv = (t) => {
    const cosT = Math.cos(t)
    const sinT = Math.sin(t)
    return [-rx * cosP * sinT - ry * sinP * cosT, -rx * sinP * sinT + ry * cosP * cosT]
  }
  for (let i = 0; i < segs; i++) {
    const t2 = th + delta
    const [p0x, p0y] = point(th)
    const [p3x, p3y] = point(t2)
    const [d0x, d0y] = deriv(th)
    const [d3x, d3y] = deriv(t2)
    out.push([p0x + alpha * d0x, p0y + alpha * d0y, p3x - alpha * d3x, p3y - alpha * d3y, p3x, p3y])
    th = t2
  }
  return out
}

/**
 * Parse path data into absolute M / L / C / Z segments (H/V→L, S/Q/T→C,
 * A→cubics). Every downstream consumer then only handles four commands.
 */
export function parseToCubics(d) {
  const tokens = d.match(TOKEN) || []
  const segs = []
  let i = 0
  let cx = 0
  let cy = 0
  let sx = 0
  let sy = 0
  let prevC2 = null
  let prevQ = null

  const pushC = (x1, y1, x2, y2, x, y) => {
    segs.push({ c: 'C', x1, y1, x2, y2, x, y })
    cx = x
    cy = y
  }
  const quadToCubic = (qx, qy, x, y) => {
    pushC(cx + (2 / 3) * (qx - cx), cy + (2 / 3) * (qy - cy), x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), x, y)
    prevQ = { x: qx, y: qy }
  }

  while (i < tokens.length) {
    const cmd = tokens[i++]
    const lower = cmd.toLowerCase()
    const rel = cmd === lower
    const n = ARGS[lower]
    if (lower === 'z') {
      segs.push({ c: 'Z' })
      cx = sx
      cy = sy
      prevC2 = prevQ = null
      continue
    }
    if (n === undefined) continue
    let first = true
    do {
      const a = []
      for (let k = 0; k < n; k++) a.push(parseFloat(tokens[i++]))
      const eff = lower === 'm' && !first ? 'l' : lower
      first = false
      switch (eff) {
        case 'm':
        case 'l': {
          const x = rel ? cx + a[0] : a[0]
          const y = rel ? cy + a[1] : a[1]
          segs.push({ c: eff === 'm' ? 'M' : 'L', x, y })
          cx = x
          cy = y
          if (eff === 'm') {
            sx = x
            sy = y
          }
          prevC2 = prevQ = null
          break
        }
        case 'h':
        case 'v': {
          const x = eff === 'h' ? (rel ? cx + a[0] : a[0]) : cx
          const y = eff === 'v' ? (rel ? cy + a[0] : a[0]) : cy
          segs.push({ c: 'L', x, y })
          cx = x
          cy = y
          prevC2 = prevQ = null
          break
        }
        case 'c': {
          const [x1, y1, x2, y2, x, y] = rel ? [cx + a[0], cy + a[1], cx + a[2], cy + a[3], cx + a[4], cy + a[5]] : a
          pushC(x1, y1, x2, y2, x, y)
          prevC2 = { x: x2, y: y2 }
          prevQ = null
          break
        }
        case 's': {
          const [x2, y2, x, y] = rel ? [cx + a[0], cy + a[1], cx + a[2], cy + a[3]] : a
          const x1 = prevC2 ? 2 * cx - prevC2.x : cx
          const y1 = prevC2 ? 2 * cy - prevC2.y : cy
          pushC(x1, y1, x2, y2, x, y)
          prevC2 = { x: x2, y: y2 }
          prevQ = null
          break
        }
        case 'q': {
          const [qx, qy, x, y] = rel ? [cx + a[0], cy + a[1], cx + a[2], cy + a[3]] : a
          quadToCubic(qx, qy, x, y)
          prevC2 = null
          break
        }
        case 't': {
          const x = rel ? cx + a[0] : a[0]
          const y = rel ? cy + a[1] : a[1]
          const qx = prevQ ? 2 * cx - prevQ.x : cx
          const qy = prevQ ? 2 * cy - prevQ.y : cy
          quadToCubic(qx, qy, x, y)
          prevC2 = null
          break
        }
        case 'a': {
          const x = rel ? cx + a[5] : a[5]
          const y = rel ? cy + a[6] : a[6]
          for (const [x1, y1, x2, y2, ex, ey] of arcToCubics(cx, cy, a[0], a[1], a[2], a[3], a[4], x, y)) {
            pushC(x1, y1, x2, y2, ex, ey)
          }
          prevC2 = prevQ = null
          break
        }
      }
    } while (i < tokens.length && !isCmd(tokens[i]))
  }
  return segs
}

// Split a cubic at t=0.5 (de Casteljau). Points are [x, y] pairs.
function splitCubic(p0, p1, p2, p3) {
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  const a = mid(p0, p1)
  const b = mid(p1, p2)
  const c = mid(p2, p3)
  const d1 = mid(a, b)
  const d2 = mid(b, c)
  const f = mid(d1, d2)
  return [[p0, a, d1, f], [f, d2, c, p3]]
}

/**
 * Project path data through `projector.pt`. Under orthographic projection the
 * map is affine, so control points map exactly; under perspective each curve
 * is subdivided first so the projected control points stay a tight
 * approximation. Straight segments are exact in both (lines map to lines).
 */
export function projectPathData(d, projector) {
  const { pt, perspective, subdivEps } = projector
  const out = []
  let cur = null // current point (unprojected)

  const emitCubic = (p0, p1, p2, p3, depth) => {
    const small =
      Math.max(
        Math.abs(p1[0] - p0[0]) + Math.abs(p1[1] - p0[1]),
        Math.abs(p2[0] - p0[0]) + Math.abs(p2[1] - p0[1]),
        Math.abs(p3[0] - p0[0]) + Math.abs(p3[1] - p0[1]),
      ) < subdivEps
    if (depth <= 0 || small) {
      const a = pt(p1[0], p1[1])
      const b = pt(p2[0], p2[1])
      const c = pt(p3[0], p3[1])
      out.push(`C ${fmt(a[0])} ${fmt(a[1])} ${fmt(b[0])} ${fmt(b[1])} ${fmt(c[0])} ${fmt(c[1])}`)
      return
    }
    const [left, right] = splitCubic(p0, p1, p2, p3)
    emitCubic(...left, depth - 1)
    emitCubic(...right, depth - 1)
  }

  for (const s of parseToCubics(d)) {
    if (s.c === 'Z') {
      out.push('Z')
      continue
    }
    if (s.c === 'M' || s.c === 'L') {
      const p = pt(s.x, s.y)
      out.push(`${s.c} ${fmt(p[0])} ${fmt(p[1])}`)
      cur = [s.x, s.y]
      continue
    }
    // C
    emitCubic(cur || [s.x1, s.y1], [s.x1, s.y1], [s.x2, s.y2], [s.x, s.y], perspective ? 3 : 0)
    cur = [s.x, s.y]
  }
  return out.join(' ')
}

/** Project a list of [x, y] points. */
export function projectPoints(points, projector) {
  return points.map(([x, y]) => {
    const p = projector.pt(x, y)
    return [fmt(p[0]), fmt(p[1])]
  })
}

/* ---------------- shape → path data (local geometry) ---------------- */

const KAPPA = 0.5522847498307936

/** Rounded (or plain) rectangle as M/L/C path data. */
export function roundedRectPath(x, y, w, h, r = 0) {
  r = Math.min(r || 0, w / 2, h / 2)
  if (r <= 0) return `M ${fmt(x)} ${fmt(y)} L ${fmt(x + w)} ${fmt(y)} L ${fmt(x + w)} ${fmt(y + h)} L ${fmt(x)} ${fmt(y + h)} Z`
  const k = KAPPA * r
  return [
    `M ${fmt(x + r)} ${fmt(y)}`,
    `L ${fmt(x + w - r)} ${fmt(y)}`,
    `C ${fmt(x + w - r + k)} ${fmt(y)} ${fmt(x + w)} ${fmt(y + r - k)} ${fmt(x + w)} ${fmt(y + r)}`,
    `L ${fmt(x + w)} ${fmt(y + h - r)}`,
    `C ${fmt(x + w)} ${fmt(y + h - r + k)} ${fmt(x + w - r + k)} ${fmt(y + h)} ${fmt(x + w - r)} ${fmt(y + h)}`,
    `L ${fmt(x + r)} ${fmt(y + h)}`,
    `C ${fmt(x + r - k)} ${fmt(y + h)} ${fmt(x)} ${fmt(y + h - r + k)} ${fmt(x)} ${fmt(y + h - r)}`,
    `L ${fmt(x)} ${fmt(y + r)}`,
    `C ${fmt(x)} ${fmt(y + r - k)} ${fmt(x + r - k)} ${fmt(y)} ${fmt(x + r)} ${fmt(y)}`,
    'Z',
  ].join(' ')
}

/** Ellipse as four cubic segments. */
export function ellipsePath(cx, cy, rx, ry) {
  const kx = KAPPA * rx
  const ky = KAPPA * ry
  return [
    `M ${fmt(cx + rx)} ${fmt(cy)}`,
    `C ${fmt(cx + rx)} ${fmt(cy + ky)} ${fmt(cx + kx)} ${fmt(cy + ry)} ${fmt(cx)} ${fmt(cy + ry)}`,
    `C ${fmt(cx - kx)} ${fmt(cy + ry)} ${fmt(cx - rx)} ${fmt(cy + ky)} ${fmt(cx - rx)} ${fmt(cy)}`,
    `C ${fmt(cx - rx)} ${fmt(cy - ky)} ${fmt(cx - kx)} ${fmt(cy - ry)} ${fmt(cx)} ${fmt(cy - ry)}`,
    `C ${fmt(cx + kx)} ${fmt(cy - ry)} ${fmt(cx + rx)} ${fmt(cy - ky)} ${fmt(cx + rx)} ${fmt(cy)}`,
    'Z',
  ].join(' ')
}

/* ---------------- preview cube (orientation gizmo) ---------------- */

// Corner order: 0-3 front face (z=0, clockwise from top-left), 4-7 the same
// corners pushed back to z=depth.
export function cubeCorners(box, depth) {
  const { x, y, width: w, height: h } = box
  return [
    [x, y, 0], [x + w, y, 0], [x + w, y + h, 0], [x, y + h, 0],
    [x, y, depth], [x + w, y, depth], [x + w, y + h, depth], [x, y + h, depth],
  ]
}

// Faces with outward normals (y-down page coords; front face toward viewer).
export const CUBE_FACES = [
  { ids: [0, 1, 2, 3], n: [0, 0, -1], front: true },
  { ids: [5, 4, 7, 6], n: [0, 0, 1] },
  { ids: [4, 5, 1, 0], n: [0, -1, 0] },
  { ids: [3, 2, 6, 7], n: [0, 1, 0] },
  { ids: [4, 0, 3, 7], n: [-1, 0, 0] },
  { ids: [1, 5, 6, 2], n: [1, 0, 0] },
]

// Edges as [cornerA, cornerB, faceA, faceB] (an edge is visible when either
// adjacent face is).
export const CUBE_EDGES = [
  [0, 1, 0, 2], [1, 2, 0, 5], [2, 3, 0, 3], [3, 0, 0, 4],
  [4, 5, 1, 2], [5, 6, 1, 5], [6, 7, 1, 3], [7, 4, 1, 4],
  [0, 4, 2, 4], [1, 5, 2, 5], [2, 6, 3, 5], [3, 7, 3, 4],
]

/**
 * Face visibility for the gizmo: rotate the outward normal and test it against
 * the view direction (orthographic) or the camera→face-center ray.
 */
export function faceVisibility(projector, corners) {
  const { rotate, distance, perspective, cx, cy } = projector
  return CUBE_FACES.map((f) => {
    const n = f.n
    const q = rotate(cx + n[0], cy + n[1], n[2]) // rotated normal (centered coords)
    if (!perspective) return q.z < 0
    const c = f.ids.reduce((acc, i) => [acc[0] + corners[i][0] / 4, acc[1] + corners[i][1] / 4, acc[2] + corners[i][2] / 4], [0, 0, 0])
    const qc = rotate(c[0], c[1], c[2])
    return q.x * qc.x + q.y * qc.y + q.z * (qc.z + distance) < 0
  })
}

/* ---------------- click-a-face to reseat the projection plane ---------------- */

// Per-face "seat" rotations, indexed like CUBE_FACES. Each maps the artwork's
// front normal [0,0,-1] onto that face's outward normal — i.e. the minimal
// rotation that lays the z=0 artwork plane onto that face of the box. Composing
// the current view M with a seat S turns the artwork to sit where the clicked
// face was; since a clicked face is (by definition) turned toward the viewer,
// the reseated artwork faces the viewer too — never edge-on. Row-major 3×3.
export const FACE_SEATS = [
  [1, 0, 0, 0, 1, 0, 0, 0, 1], //  front  — identity (already the artwork plane)
  [-1, 0, 0, 0, 1, 0, 0, 0, -1], // back   — Ry(180)
  [1, 0, 0, 0, 0, 1, 0, -1, 0], //  top    — Rx(-90)
  [1, 0, 0, 0, 0, -1, 0, 1, 0], //  bottom — Rx(90)
  [0, 0, 1, 0, 1, 0, -1, 0, 0], //  left   — Ry(-90)
  [0, 0, -1, 0, 1, 0, 1, 0, 0], //  right  — Ry(90)
]

/** Row-major 3×3 product a·b. */
function mat3Mul(a, b) {
  const out = new Array(9)
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]
    }
  }
  return out
}

/**
 * Recover Euler angles (degrees) from a rotation matrix under this module's
 * M = Rx·Ry·Rz convention, so the result feeds back into rotationMatrix()/
 * makeProjector() unchanged. Falls back to a stable rz=0 split at gimbal lock
 * (ry = ±90°), where rx and rz are otherwise indistinguishable.
 */
export function eulerXYZFromMatrix(m) {
  const deg = (r) => (r * 180) / Math.PI
  const cy = Math.hypot(m[0], m[1]) // cy = √((cy·cz)² + (cy·sz)²)
  const ry = Math.atan2(-m[2], cy) // sy = -m[2]
  if (cy > 1e-6) {
    return { rx: deg(Math.atan2(-m[5], m[8])), ry: deg(ry), rz: deg(Math.atan2(-m[1], m[0])) }
  }
  // Gimbal lock: pin rz, read rx from the (rz=0) reduced matrix (sx=m[7], cx=m[4]).
  return { rx: deg(Math.atan2(m[7], m[4])), ry: deg(ry), rz: 0 }
}

/**
 * Target angles for "click this cube face to make it the projection plane":
 * keep the current viewing orientation and roll the artwork's plane onto the
 * clicked face. `faceIndex` indexes CUBE_FACES / FACE_SEATS.
 */
export function faceViewParams(faceIndex, params) {
  const seat = FACE_SEATS[faceIndex]
  if (!seat) return { rx: params.rx, ry: params.ry, rz: params.rz }
  const m = mat3Mul(rotationMatrix(params.rx, params.ry, params.rz), seat)
  const e = eulerXYZFromMatrix(m)
  return { rx: wrapAngle(e.rx), ry: wrapAngle(e.ry), rz: wrapAngle(e.rz) }
}
