// Session plumbing for the 3D transform feature: turn document nodes into
// projectable *source* geometry (with rotation/flip baked, so the projection
// composes on what you see), and turn projected sources back into node
// patches. Everything here is synchronous except buildT3DSession, which
// pre-outlines text nodes via opentype once per session.

import { geometryBBox, nodeBounds, unionBBox } from './bbox'
import { transformPathData } from './pathTransform'
import { textNodeToPath } from '../io/textToPath'
import { roundedRectPath, ellipsePath, projectPathData, projectPoints, T3D_DEFAULTS } from './projection3d'

const r3 = (n) => Math.round(n * 1000) / 1000

/** Affine [a,b,c,d,e,f] baking a node's flip + rotation about its geometry
 * center (the same frame nodeTransform renders with); null when upright. */
export function nodeBakeMatrix(node) {
  if (!node.rotation && !node.flipX && !node.flipY) return null
  const lb = geometryBBox(node)
  const cx = lb.x + lb.width / 2
  const cy = lb.y + lb.height / 2
  const fx = node.flipX ? -1 : 1
  const fy = node.flipY ? -1 : 1
  const r = ((node.rotation || 0) * Math.PI) / 180
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  const a = cos * fx
  const b = sin * fx
  const c = -sin * fy
  const d = cos * fy
  return [a, b, c, d, cx - (a * cx + c * cy), cy - (b * cx + d * cy)]
}

const applyMat = (m, [x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]

// Key of everything a text outline depends on — a session's cached outline is
// only used while the node still matches it.
export function textSnapshotKey(node) {
  return [node.text, node.x, node.y, node.fontSize, node.fontFamily, node.fontWeight, node.fontStyle, node.align, node.rotation, node.flipX, node.flipY].join('|')
}

/**
 * A node's projectable source geometry (page coords, rotation/flip baked):
 *   { kind: 'd', d } | { kind: 'points', points, closed } | { kind: 'line', x1.. }
 * Returns null for images/groups and for text without a valid cached outline.
 */
export function nodeSource(node, textD = {}) {
  const m = nodeBakeMatrix(node)
  switch (node.type) {
    case 'rect': {
      const d = roundedRectPath(node.x, node.y, node.width, node.height, node.rx || 0)
      return { kind: 'd', d: m ? transformPathData(d, m) : d }
    }
    case 'ellipse': {
      const d = ellipsePath(node.cx, node.cy, node.rx, node.ry)
      return { kind: 'd', d: m ? transformPathData(d, m) : d }
    }
    case 'path':
      return { kind: 'd', d: m ? transformPathData(node.d, m) : node.d }
    case 'polygon':
      return {
        kind: 'points',
        points: m ? node.points.map((p) => applyMat(m, p)) : node.points.map((p) => [p[0], p[1]]),
        closed: node.closed !== false,
      }
    case 'line': {
      const p1 = m ? applyMat(m, [node.x1, node.y1]) : [node.x1, node.y1]
      const p2 = m ? applyMat(m, [node.x2, node.y2]) : [node.x2, node.y2]
      return { kind: 'line', x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1] }
    }
    case 'image':
      // Images can't become paths, so they carry their rect + any existing
      // affine (a previously-baked 3D transform, else rotation/flip) as the
      // matrix the next projection composes onto.
      return {
        kind: 'image',
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        href: node.href,
        m: node.matrix || nodeBakeMatrix(node),
      }
    case 'text': {
      const t = textD[node.id]
      return t && t.key === textSnapshotKey(node) ? { kind: 'd', d: t.d } : null
    }
    default:
      return null
  }
}

/** Project a source through the projector into a node type + geometry patch. */
export function projectSource(src, projector) {
  switch (src.kind) {
    case 'd':
      return { type: 'path', geom: { d: projectPathData(src.d, projector) } }
    case 'points':
      return { type: 'polygon', geom: { points: projectPoints(src.points, projector), closed: src.closed } }
    case 'line': {
      const a = projector.pt(src.x1, src.y1)
      const b = projector.pt(src.x2, src.y2)
      return { type: 'line', geom: { x1: r3(a[0]), y1: r3(a[1]), x2: r3(b[0]), y2: r3(b[1]) } }
    }
    case 'image': {
      // A raster can only carry an affine, and orthographic projection of the
      // z=0 plane is exactly affine — so map the image's rect onto the projected
      // parallelogram via a transform matrix. Perspective isn't affine, so we
      // skip it (the image stays flat).
      if (projector.perspective) return null
      const { x, y, width: w, height: h, href, m } = src
      const corners = [[x, y], [x + w, y], [x, y + h]].map((p) => (m ? applyMat(m, p) : p))
      const P = corners.map(([px, py]) => projector.pt(px, py))
      const bw = w || 1
      const bh = h || 1
      const a = (P[1][0] - P[0][0]) / bw
      const b = (P[1][1] - P[0][1]) / bw
      const c = (P[2][0] - P[0][0]) / bh
      const d = (P[2][1] - P[0][1]) / bh
      const e = P[0][0] - a * x - c * y
      const f = P[0][1] - b * x - d * y
      return { type: 'image', geom: { x, y, width: w, height: h, href, matrix: [a, b, c, d, e, f].map(r3) } }
    }
    default:
      return null
  }
}

/** Rendered bounds of the session nodes — the projection pivots on its center. */
export function sessionBounds(doc, ids) {
  return unionBBox(ids.map((id) => (doc.nodes[id] ? nodeBounds(doc.nodes[id], doc.nodes) : null)))
}

/**
 * Build a 3D-transform session for the current selection: collect projectable
 * leaves (locked nodes and images are skipped) and pre-outline text nodes.
 * Returns null when nothing in the selection can be transformed.
 */
export async function buildT3DSession(doc, selection) {
  const leaves = []
  const walk = (id) => {
    const n = doc.nodes[id]
    if (!n) return
    if (n.type === 'group') n.children.forEach(walk)
    else leaves.push(n)
  }
  selection.forEach(walk)

  const ids = []
  const textD = {}
  let skippedImages = 0
  let skippedText = 0
  for (const n of leaves) {
    if (n.locked) continue
    if (n.type === 'text') {
      try {
        const d = await textNodeToPath(n)
        textD[n.id] = { d, key: textSnapshotKey(n) }
      } catch {
        skippedText += 1 // font unavailable — leave this text out
        continue
      }
    }
    if (nodeSource(n, textD)) ids.push(n.id)
  }
  if (!ids.length) return null
  return {
    selKey: selection.join('\n'),
    ids,
    params: { ...T3D_DEFAULTS },
    textD,
    skippedImages,
    skippedText,
  }
}
