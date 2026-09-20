import { geometryBBox } from '../model/bbox'

// Paper.js is heavy, so it's imported on first use (boolean op) and a single
// headless project is reused. We attach an offscreen canvas so Paper sets up a
// real project; we only ever use it for path math, never for rendering.
let paperPromise = null

export function getPaper() {
  if (!paperPromise) {
    paperPromise = import('paper').then((m) => {
      const paper = m.default || m
      // Size-based setup needs no canvas 2D context (works in browser and
      // headless/jsdom); fall back to a canvas element if that ever fails.
      try {
        paper.setup(new paper.Size(1, 1))
      } catch {
        paper.setup(document.createElement('canvas'))
      }
      return paper
    })
  }
  return paperPromise
}

/** Node types that enclose an area and can take part in boolean operations. */
export function isBooleanable(node) {
  return !!node && (node.type === 'rect' || node.type === 'ellipse' || node.type === 'polygon' || node.type === 'path')
}

/**
 * A plain raster image — one that still maps to an upright rectangle in page
 * space (so its area can be used as a boolean operand). A `matrix` image has
 * been baked by a 3D transform and no longer has an axis-aligned box; it is
 * excluded.
 */
export function isRasterImage(node) {
  return !!node && node.type === 'image' && !node.matrix
}

/** Build a Paper path/compound-path from a node, baking its rotation + flip. */
export function nodeToPaperPath(paper, node) {
  let path
  switch (node.type) {
    case 'image':
      path = new paper.Path.Rectangle(new paper.Rectangle(node.x, node.y, node.width, node.height))
      break
    case 'rect':
      path = node.rx
        ? new paper.Path.Rectangle({ point: [node.x, node.y], size: [node.width, node.height], radius: node.rx })
        : new paper.Path.Rectangle(new paper.Rectangle(node.x, node.y, node.width, node.height))
      break
    case 'ellipse':
      path = new paper.Path.Ellipse({ center: [node.cx, node.cy], radius: [node.rx, node.ry] })
      break
    case 'polygon':
      path = new paper.Path({ segments: node.points.map((p) => [p[0], p[1]]), closed: node.closed !== false })
      break
    case 'path':
      path = new paper.CompoundPath(node.d)
      break
    default:
      return null
  }
  // Match nodeTransform order: flip about center, then rotate about center.
  const b = geometryBBox(node)
  const center = new paper.Point(b.x + b.width / 2, b.y + b.height / 2)
  if (node.flipX || node.flipY) path.scale(node.flipX ? -1 : 1, node.flipY ? -1 : 1, center)
  if (node.rotation) path.rotate(node.rotation, center)
  return path
}
