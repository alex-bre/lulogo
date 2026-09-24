import { createRect, createEllipse, createPolygon, createPath, regularPolygonPoints, starPoints, applyDefaultStyle } from './nodes'

// Canonical playing-card suit colors.
const SUIT_RED = '#d64045'
const SUIT_BLACK = '#1a1d21'

// The shape library shown in the left panel.
// Palette sections, in display order. Each kind below names its group.
export const SHAPE_GROUPS = [
  { id: 'basic', label: 'Basic' },
  { id: 'polygons', label: 'Polygons & stars' },
  { id: 'suits', label: 'Card suits' },
  { id: '3d', label: '3D' },
]

export const SHAPE_KINDS = [
  { kind: 'rect', label: 'Rectangle', group: 'basic' },
  { kind: 'square', label: 'Square', group: 'basic' },
  { kind: 'rounded', label: 'Rounded', group: 'basic' },
  { kind: 'pill', label: 'Pill', group: 'basic' },
  { kind: 'circle', label: 'Circle', group: 'basic' },
  { kind: 'ellipse', label: 'Ellipse', group: 'basic' },
  { kind: 'ring', label: 'Ring', group: 'basic' },
  { kind: 'half-circle', label: 'Half-circle', group: 'basic' },
  { kind: 'quarter-circle', label: 'Quarter-circle', group: 'basic' },
  { kind: 'triangle', label: 'Triangle', group: 'basic' },
  { kind: 'right-triangle', label: 'Right triangle', group: 'basic' },
  { kind: 'pentagon', label: 'Pentagon', group: 'polygons' },
  { kind: 'hexagon', label: 'Hexagon', group: 'polygons' },
  { kind: 'star', label: 'Star', group: 'polygons' },
  { kind: 'star-4', label: '4-point star', group: 'polygons' },
  { kind: 'star-6', label: '6-point star', group: 'polygons' },
  { kind: 'heart', label: 'Heart', group: 'suits' },
  { kind: 'diamond', label: 'Diamond', group: 'suits' },
  { kind: 'spade', label: 'Spade', group: 'suits' },
  { kind: 'club', label: 'Club', group: 'suits' },
  { kind: 'cube', label: 'Isometric cube', group: '3d' },
  { kind: 'cone', label: 'Cone', group: '3d' },
]

// Control-point distance for a circular quarter-arc cubic bezier.
const KAPPA = 0.5522847498307936
const r2 = (n) => Math.round(n * 100) / 100

// Dome-up half circle, bounding box centered on (px, py): width 2r, height r.
function halfCirclePath(px, py, r) {
  const k = KAPPA * r
  const flat = py + r / 2 // diameter line
  const top = py - r / 2 // dome apex
  return (
    `M ${r2(px - r)} ${r2(flat)} ` +
    `C ${r2(px - r)} ${r2(flat - k)} ${r2(px - k)} ${r2(top)} ${r2(px)} ${r2(top)} ` +
    `C ${r2(px + k)} ${r2(top)} ${r2(px + r)} ${r2(flat - k)} ${r2(px + r)} ${r2(flat)} Z`
  )
}

// Quarter circle: the right angle sits bottom-left, bounding box (r x r)
// centered on (px, py).
function quarterCirclePath(px, py, r) {
  const k = KAPPA * r
  const x0 = px - r / 2
  const y0 = py + r / 2
  return (
    `M ${r2(x0)} ${r2(y0)} L ${r2(x0 + r)} ${r2(y0)} ` +
    `C ${r2(x0 + r)} ${r2(y0 - k)} ${r2(x0 + k)} ${r2(y0 - r)} ${r2(x0)} ${r2(y0 - r)} Z`
  )
}

// Isometric cube: three rhombus faces (top, right, left). Rendered with fill +
// stroke so the shared edges read as the cube's wireframe.
function cubePath(px, py, R) {
  const hx = 0.8660254037844386 * R // cos(30°)
  const half = R / 2
  const P = (x, y) => `${r2(x)} ${r2(y)}`
  const T = P(px, py - R)
  const UR = P(px + hx, py - half)
  const LR = P(px + hx, py + half)
  const B = P(px, py + R)
  const LL = P(px - hx, py + half)
  const UL = P(px - hx, py - half)
  const C = P(px, py)
  return (
    `M ${T} L ${UR} L ${C} L ${UL} Z ` + // top face
    `M ${UR} L ${LR} L ${B} L ${C} Z ` + // right face
    `M ${UL} L ${C} L ${B} L ${LL} Z` // left face
  )
}

// Cone: apex + two sides down to an elliptical base (front/bottom arc).
function conePath(px, py, w, h, ry) {
  const rx = w / 2
  const apexY = py - h / 2
  const baseCY = py + h / 2 - ry
  const kx = KAPPA * rx
  const ky = KAPPA * ry
  return (
    `M ${r2(px)} ${r2(apexY)} L ${r2(px - rx)} ${r2(baseCY)} ` +
    `C ${r2(px - rx)} ${r2(baseCY + ky)} ${r2(px - kx)} ${r2(baseCY + ry)} ${r2(px)} ${r2(baseCY + ry)} ` +
    `C ${r2(px + kx)} ${r2(baseCY + ry)} ${r2(px + rx)} ${r2(baseCY + ky)} ${r2(px + rx)} ${r2(baseCY)} Z`
  )
}

// Full circle as a 4-bezier subpath (used to build the club's clover).
function circleSub(cx, cy, r) {
  const k = KAPPA * r
  return (
    `M ${r2(cx + r)} ${r2(cy)} ` +
    `C ${r2(cx + r)} ${r2(cy + k)} ${r2(cx + k)} ${r2(cy + r)} ${r2(cx)} ${r2(cy + r)} ` +
    `C ${r2(cx - k)} ${r2(cy + r)} ${r2(cx - r)} ${r2(cy + k)} ${r2(cx - r)} ${r2(cy)} ` +
    `C ${r2(cx - r)} ${r2(cy - k)} ${r2(cx - k)} ${r2(cy - r)} ${r2(cx)} ${r2(cy - r)} ` +
    `C ${r2(cx + k)} ${r2(cy - r)} ${r2(cx + r)} ${r2(cy - k)} ${r2(cx + r)} ${r2(cy)} Z`
  )
}

// The same circle wound the other way round.
function circleSubReversed(cx, cy, r) {
  const k = KAPPA * r
  return (
    `M ${r2(cx + r)} ${r2(cy)} ` +
    `C ${r2(cx + r)} ${r2(cy - k)} ${r2(cx + k)} ${r2(cy - r)} ${r2(cx)} ${r2(cy - r)} ` +
    `C ${r2(cx - k)} ${r2(cy - r)} ${r2(cx - r)} ${r2(cy - k)} ${r2(cx - r)} ${r2(cy)} ` +
    `C ${r2(cx - r)} ${r2(cy + k)} ${r2(cx - k)} ${r2(cy + r)} ${r2(cx)} ${r2(cy + r)} ` +
    `C ${r2(cx + k)} ${r2(cy + r)} ${r2(cx + r)} ${r2(cy + k)} ${r2(cx + r)} ${r2(cy)} Z`
  )
}

// Ring (donut): the hole is the inner circle wound opposite to the outer one,
// so it stays open under the default nonzero fill rule.
function ringPath(px, py, outer, inner) {
  return `${circleSub(px, py, outer)} ${circleSubReversed(px, py, inner)}`
}

// The heart/spade lobed outline, normalized to unit `s` and centered on (px,py).
// `dir` = 1 points the cusp downward (heart); dir = -1 points it up (spade body).
function lobedPath(px, py, s, dir) {
  const P = (x, y) => `${r2(px + x * s)} ${r2(py + y * s * dir)}`
  return (
    `M ${P(0, -0.45)} ` +
    `C ${P(-0.2, -0.75)} ${P(-0.6, -0.95)} ${P(-0.88, -0.62)} ` +
    `C ${P(-1.08, -0.42)} ${P(-1.0, -0.02)} ${P(-0.72, 0.22)} ` +
    `C ${P(-0.5, 0.42)} ${P(-0.18, 0.62)} ${P(0, 0.98)} ` +
    `C ${P(0.18, 0.62)} ${P(0.5, 0.42)} ${P(0.72, 0.22)} ` +
    `C ${P(1.0, -0.02)} ${P(1.08, -0.42)} ${P(0.88, -0.62)} ` +
    `C ${P(0.6, -0.95)} ${P(0.2, -0.75)} ${P(0, -0.45)} Z`
  )
}

// Spade: an upward-pointing heart body plus a flared stem at the bottom.
function spadePath(px, py, s) {
  const P = (x, y) => `${r2(px + x * s)} ${r2(py + y * s)}`
  const stem =
    `M ${P(-0.34, 0.98)} ` +
    `C ${P(-0.14, 0.72)} ${P(-0.16, 0.56)} ${P(0, 0.45)} ` +
    `C ${P(0.16, 0.56)} ${P(0.14, 0.72)} ${P(0.34, 0.98)} Z`
  return `${lobedPath(px, py, s, -1)} ${stem}`
}

// Club: three circles in a triangle plus a flared stem.
function clubPath(px, py, R) {
  const r = 0.4 * R
  const P = (x, y) => `${r2(px + x * R)} ${r2(py + y * R)}`
  const stem =
    `M ${P(-0.32, 0.98)} ` +
    `C ${P(-0.12, 0.62)} ${P(-0.14, 0.42)} ${P(0, 0.3)} ` +
    `C ${P(0.14, 0.42)} ${P(0.12, 0.62)} ${P(0.32, 0.98)} Z`
  return `${circleSub(px, py - 0.42 * R, r)} ${circleSub(px - 0.46 * R, py + 0.18 * R, r)} ${circleSub(px + 0.46 * R, py + 0.18 * R, r)} ${stem}`
}

/**
 * Create a library shape centered on (cx, cy) in page coordinates, painted with
 * the document's default style (General tab). Shapes whose color or stroke is
 * part of their identity keep it — see applyDefaultStyle.
 */
export function createShapeOfKind(kind, cx, cy, defaults) {
  return applyDefaultStyle(buildShape(kind, cx, cy), defaults)
}

function buildShape(kind, cx, cy) {
  switch (kind) {
    case 'rect':
      return createRect({ x: cx - 90, y: cy - 60, width: 180, height: 120 })
    case 'square':
      return createRect({ x: cx - 75, y: cy - 75, width: 150, height: 150, name: 'Square' })
    case 'pill':
      return createRect({ x: cx - 110, y: cy - 50, width: 220, height: 100, rx: 50, name: 'Pill' })
    case 'rounded':
      return createRect({ x: cx - 90, y: cy - 60, width: 180, height: 120, rx: 16 })
    case 'circle':
      return createEllipse({ cx, cy, rx: 80, ry: 80, name: 'Circle' })
    case 'ellipse':
      return createEllipse({ cx, cy, rx: 90, ry: 70 })
    case 'triangle':
      return createPolygon({ points: regularPolygonPoints(cx, cy, 95, 3), name: 'Triangle' })
    case 'right-triangle':
      return createPolygon({
        points: [
          [cx - 85, cy + 75],
          [cx + 85, cy + 75],
          [cx - 85, cy - 75],
        ],
        name: 'Right triangle',
      })
    case 'ring':
      return createPath({ d: ringPath(cx, cy, 80, 48), name: 'Ring' })
    case 'quarter-circle':
      return createPath({ d: quarterCirclePath(cx, cy, 150), name: 'Quarter-circle' })
    case 'half-circle':
      return createPath({ d: halfCirclePath(cx, cy, 95), name: 'Half-circle' })
    case 'pentagon':
      return createPolygon({ points: regularPolygonPoints(cx, cy, 90, 5), name: 'Pentagon' })
    case 'hexagon':
      return createPolygon({ points: regularPolygonPoints(cx, cy, 90, 6), name: 'Hexagon' })
    case 'star':
      return createPolygon({ points: starPoints(cx, cy, 95, 42, 5), name: 'Star' })
    case 'star-4':
      return createPolygon({ points: starPoints(cx, cy, 95, 30, 4), name: '4-point star' })
    case 'star-6':
      // Inner radius outer/√3 puts the notches on the lines of two overlapping triangles.
      return createPolygon({ points: starPoints(cx, cy, 95, 54.85, 6), name: '6-point star' })
    case 'cube':
      return createPath({ d: cubePath(cx, cy, 85), name: 'Cube', style: { stroke: '#5b6470', strokeWidth: 2 } })
    case 'cone':
      return createPath({ d: conePath(cx, cy, 150, 185, 22), name: 'Cone' })
    case 'heart':
      return createPath({ d: lobedPath(cx, cy, 92, 1), name: 'Heart', style: { fill: SUIT_RED } })
    case 'diamond':
      return createPolygon({
        points: [
          [cx, cy - 95],
          [cx + 64, cy],
          [cx, cy + 95],
          [cx - 64, cy],
        ],
        name: 'Diamond',
        style: { fill: SUIT_RED },
      })
    case 'spade':
      return createPath({ d: spadePath(cx, cy, 88), name: 'Spade', style: { fill: SUIT_BLACK } })
    case 'club':
      return createPath({ d: clubPath(cx, cy, 92), name: 'Club', style: { fill: SUIT_BLACK } })
    default:
      return createRect({ x: cx - 90, y: cy - 60, width: 180, height: 120 })
  }
}
