import { genId } from './nodes'
import { transformPathData } from './pathTransform'

/**
 * Translate a node in place by (dx, dy) in page coordinates. Geometry is baked
 * so no transform attribute is produced. Groups translate their descendants.
 */
export function translateNode(node, dx, dy, nodes) {
  switch (node.type) {
    case 'image':
      // A baked affine carries its own placement — shift the matrix, not x/y.
      if (node.matrix) {
        node.matrix[4] += dx
        node.matrix[5] += dy
      } else {
        node.x += dx
        node.y += dy
      }
      break
    case 'rect':
    case 'text':
      node.x += dx
      node.y += dy
      break
    case 'ellipse':
      node.cx += dx
      node.cy += dy
      break
    case 'line':
      node.x1 += dx
      node.y1 += dy
      node.x2 += dx
      node.y2 += dy
      break
    case 'polygon':
      node.points = node.points.map(([px, py]) => [px + dx, py + dy])
      break
    case 'path':
      node.d = transformPathData(node.d, [1, 0, 0, 1, dx, dy])
      break
    case 'group':
      node.children.forEach((id) => nodes[id] && translateNode(nodes[id], dx, dy, nodes))
      break
    default:
      break
  }
}

/**
 * Scale a node in place about anchor (ox, oy) by (sx, sy), in page coordinates.
 * Geometry is baked (no transform). Groups scale their descendants. Callers
 * keep sx/sy positive (flips have their own flag) to avoid inverted geometry.
 */
export function scaleNode(node, ox, oy, sx, sy, nodes) {
  const sp = (x, y) => [ox + (x - ox) * sx, oy + (y - oy) * sy]
  switch (node.type) {
    case 'rect':
    case 'image': {
      // Baked-affine image: left-compose the scale-about-anchor into the matrix.
      if (node.type === 'image' && node.matrix) {
        const [a, b, c, d, e, f] = node.matrix
        node.matrix = [sx * a, sy * b, sx * c, sy * d, sx * e + ox * (1 - sx), sy * f + oy * (1 - sy)]
        break
      }
      const [nx, ny] = sp(node.x, node.y)
      node.x = nx
      node.y = ny
      node.width *= sx
      node.height *= sy
      if (node.type === 'rect' && node.rx) node.rx *= Math.min(sx, sy)
      break
    }
    case 'ellipse': {
      const [cx, cy] = sp(node.cx, node.cy)
      node.cx = cx
      node.cy = cy
      node.rx *= sx
      node.ry *= sy
      break
    }
    case 'line': {
      const [a, b] = sp(node.x1, node.y1)
      const [c, d] = sp(node.x2, node.y2)
      node.x1 = a
      node.y1 = b
      node.x2 = c
      node.y2 = d
      break
    }
    case 'polygon':
      node.points = node.points.map(([x, y]) => sp(x, y))
      break
    case 'text': {
      const [nx, ny] = sp(node.x, node.y)
      node.x = nx
      node.y = ny
      node.fontSize *= sy
      break
    }
    case 'path':
      // Scale about (ox, oy): x' = sx*x + ox*(1-sx).
      node.d = transformPathData(node.d, [sx, 0, 0, sy, ox * (1 - sx), oy * (1 - sy)])
      break
    case 'group':
      node.children.forEach((id) => nodes[id] && scaleNode(nodes[id], ox, oy, sx, sy, nodes))
      break
    default:
      break
  }
}

/** Rewrite a `url(#gradId)` style reference to point at a fresh, independent
 * copy of the gradient so the clone never shares a paint server with its
 * source. Returns the (possibly unchanged) reference value. */
function cloneGradientRef(value, gradients, intoGradients) {
  const m = typeof value === 'string' && value.match(/^url\(#(.+)\)$/)
  if (!m || !gradients) return value
  const src = gradients[m[1]]
  if (!src) return value
  const id = genId('grad')
  intoGradients[id] = { ...JSON.parse(JSON.stringify(src)), id }
  return `url(#${id})`
}

/**
 * Deep-clone a node subtree with fresh ids, inserting every clone into `into`
 * (the destination nodes map). Returns the root clone; the caller wires its
 * placement into rootOrder / a parent's children.
 *
 * When `gradients`/`intoGradients` are supplied, any gradient paint server a
 * node references is duplicated too, so editing the clone's gradient never
 * mutates the original's.
 */
export function cloneSubtree(node, nodes, into, gradients, intoGradients) {
  const copy = JSON.parse(JSON.stringify(node))
  copy.id = genId(node.type)
  if (intoGradients && copy.style) {
    copy.style.fill = cloneGradientRef(copy.style.fill, gradients, intoGradients)
    copy.style.stroke = cloneGradientRef(copy.style.stroke, gradients, intoGradients)
  }
  if (copy.type === 'group') {
    copy.children = node.children.map((cid) => {
      const child = cloneSubtree(nodes[cid], nodes, into, gradients, intoGradients)
      child.parent = copy.id
      return child.id
    })
  }
  into[copy.id] = copy
  return copy
}
