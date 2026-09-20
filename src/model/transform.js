import { geometryBBox } from './bbox'

const r = (n) => Math.round(n * 1000) / 1000

/** Rotate point p about center c by `deg` degrees (page coordinates). */
export function rotatePointAbout(p, c, deg) {
  const rad = (deg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dx = p.x - c.x
  const dy = p.y - c.y
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos }
}

/**
 * Build the SVG `transform` value for a node from its rotation + flip, applied
 * about the geometry center. Returns undefined when the node is upright and
 * un-flipped — so plain shapes carry no transform attribute (clean export).
 */
export function nodeTransform(node) {
  // A baked affine (e.g. a 3D-transformed image) is the whole transform — it
  // already folds in any rotation/flip, so it wins outright.
  if (node.matrix) return `matrix(${node.matrix.map(r).join(' ')})`
  if (!node.rotation && !node.flipX && !node.flipY) return undefined
  const b = geometryBBox(node)
  const cx = b.x + b.width / 2
  const cy = b.y + b.height / 2
  const parts = []
  if (node.flipX || node.flipY) {
    const sx = node.flipX ? -1 : 1
    const sy = node.flipY ? -1 : 1
    parts.push(`translate(${r(cx)} ${r(cy)}) scale(${sx} ${sy}) translate(${r(-cx)} ${r(-cy)})`)
  }
  // Rotation is outermost (applied last), i.e. flip the shape, then rotate it.
  if (node.rotation) parts.unshift(`rotate(${r(node.rotation)} ${r(cx)} ${r(cy)})`)
  return parts.join(' ')
}
