import { getPaper, nodeToPaperPath, isBooleanable, isRasterImage } from './paperBridge'
import { rasterizeImageIntersection } from './imageMask'

/** All node ids in paint order (back to front), descending into groups. */
export function flattenOrder(doc) {
  const out = []
  const walk = (ids) => {
    for (const id of ids) {
      const n = doc.nodes[id]
      if (!n) continue
      out.push(id)
      if (n.type === 'group') walk(n.children)
    }
  }
  walk(doc.rootOrder)
  return out
}

const OPS = {
  union: (a, b) => a.unite(b),
  subtract: (a, b) => a.subtract(b),
  intersect: (a, b) => a.intersect(b),
  exclude: (a, b) => a.exclude(b),
}

// When a group is the base and the op is distributed across its members, the
// other operands (the "cutter") are folded into a single tool shape. Subtract
// isn't associative — base − a − b = base − (a ∪ b) — so its cutters are
// UNIONed; the associative ops fold with themselves.
const TOOL_FOLD = { subtract: 'union', intersect: 'intersect', exclude: 'exclude' }

function isDescendant(doc, id, ancestorId) {
  let p = doc.nodes[id] ? doc.nodes[id].parent : null
  while (p) {
    if (p === ancestorId) return true
    p = doc.nodes[p] ? doc.nodes[p].parent : null
  }
  return false
}

/** Booleanable leaf ids inside a subtree, in paint order (descends into groups). */
function booleanableLeaves(doc, id) {
  const n = doc.nodes[id]
  if (!n) return []
  if (n.type === 'group') return n.children.flatMap((c) => booleanableLeaves(doc, c))
  return isBooleanable(n) ? [id] : []
}

/**
 * One Paper path representing a whole operand: a plain shape → its path; a group
 * → the union of its booleanable leaves (so a group acts as a single object).
 */
function operandShape(paper, doc, id) {
  const n = doc.nodes[id]
  if (!n) return null
  if (n.type !== 'group') return isBooleanable(n) || isRasterImage(n) ? nodeToPaperPath(paper, n) : null
  const leaves = booleanableLeaves(doc, id)
  if (!leaves.length) return null
  let u = nodeToPaperPath(paper, doc.nodes[leaves[0]])
  for (let i = 1; i < leaves.length; i++) u = u.unite(nodeToPaperPath(paper, doc.nodes[leaves[i]]))
  return u
}

/**
 * Compute a boolean operation over the selection and return a plan the store can
 * apply. Operands are taken bottom→top, so `subtract` removes upper shapes from
 * the lowest one. A group operand counts as a single object (the union of its
 * members).
 *
 * When the bottom-most operand is a group and the op cuts (subtract / intersect
 * / exclude), the op is *distributed* across the group's members — each member
 * is cut by the other operand(s) and the group itself is kept. That plan is
 * `{ kind: 'group-distribute', groupId, replace, removeIds }`. Otherwise the
 * result is a single merged path `{ d, style, baseId, removeIds }`.
 *
 * Returns null when nothing usable results. Async: Paper.js is lazy-loaded.
 */
export async function performBoolean(doc, ids, op) {
  const fn = OPS[op]
  if (!fn) return null
  const order = flattenOrder(doc)

  // A raster image can't take part in path math. The one operation that still
  // makes sense on it is Intersect — clip the image to the overlapping area —
  // and it produces a new (smaller, masked) image rather than a path. Every
  // other op is refused while an image is in the selection.
  if (ids.some((id) => doc.nodes[id] && doc.nodes[id].type === 'image')) {
    return op === 'intersect' ? performImageIntersect(doc, ids, order) : null
  }

  // Operands: selected shapes / non-empty groups, excluding anything nested in
  // another selected group (so a group and one of its children aren't both
  // counted). Bottom→top.
  const operands = ids
    .filter((id) => {
      const n = doc.nodes[id]
      if (!n) return false
      if (ids.some((o) => o !== id && doc.nodes[o]?.type === 'group' && isDescendant(doc, id, o))) return false
      return n.type === 'group' ? booleanableLeaves(doc, id).length > 0 : isBooleanable(n)
    })
    .sort((x, y) => order.indexOf(x) - order.indexOf(y))
  if (operands.length < 2) return null

  const paper = await getPaper()
  try {
    const base = operands[0]
    const baseNode = doc.nodes[base]
    const others = operands.slice(1)
    const distribute = baseNode.type === 'group' && op !== 'union'

    if (distribute) {
      // Fold the cutters into one tool, then apply the op to each group member.
      const toolFn = OPS[TOOL_FOLD[op]]
      let tool = operandShape(paper, doc, others[0])
      for (let i = 1; i < others.length; i++) tool = toolFn(tool, operandShape(paper, doc, others[i]))
      if (!tool) return null
      const toolBounds = tool.bounds

      const replace = []
      for (const leafId of booleanableLeaves(doc, base)) {
        const leaf = doc.nodes[leafId]
        const lp = nodeToPaperPath(paper, leaf)
        if (!lp.bounds.intersects(toolBounds)) {
          // The cutter doesn't reach this member: it vanishes under intersect,
          // and is left untouched under subtract / exclude.
          if (op === 'intersect') replace.push({ id: leafId, d: null })
          continue
        }
        const res = fn(lp, tool.clone())
        replace.push({ id: leafId, d: res.pathData || null, style: { ...leaf.style } })
      }
      return { kind: 'group-distribute', groupId: base, replace, removeIds: others }
    }

    // Merge everything (each group → its union) into a single path.
    let result = operandShape(paper, doc, base)
    for (const id of others) result = fn(result, operandShape(paper, doc, id))
    const d = result && result.pathData
    if (!d) return null
    return { d, style: { ...baseNode.style }, baseId: base, removeIds: operands }
  } finally {
    paper.project.activeLayer.removeChildren()
  }
}

/**
 * Intersect a selection that contains a raster image. The overlap of every
 * operand's area (images count as their rectangle; groups as their union) is
 * computed, then the bottom-most image's pixels are re-rasterised into a fresh
 * PNG the size of that overlap, with everything outside its outline erased to
 * transparency.
 *
 * Returns `{ kind: 'image-intersect', baseId, image, removeIds }` for the store,
 * or null when there is nothing to intersect or the overlap is empty. Async:
 * Paper.js plus an <img>/<canvas> round-trip.
 */
async function performImageIntersect(doc, ids, order) {
  const operands = ids
    .filter((id) => {
      const n = doc.nodes[id]
      if (!n) return false
      if (ids.some((o) => o !== id && doc.nodes[o]?.type === 'group' && isDescendant(doc, id, o))) return false
      if (n.type === 'group') return booleanableLeaves(doc, id).length > 0
      return isRasterImage(n) || isBooleanable(n)
    })
    .sort((x, y) => order.indexOf(x) - order.indexOf(y))

  // The pixel source is the bottom-most image; it also needs something to be
  // intersected against.
  const imageId = operands.find((id) => isRasterImage(doc.nodes[id]))
  if (!imageId || operands.length < 2) return null

  const paper = await getPaper()
  try {
    let region = operandShape(paper, doc, operands[0])
    for (let i = 1; i < operands.length && region; i++) {
      region = region.intersect(operandShape(paper, doc, operands[i]))
    }
    const d = region && region.pathData
    const bnd = region && region.bounds
    if (!d || !bnd || bnd.width <= 0 || bnd.height <= 0) return null

    const src = doc.nodes[imageId]
    const raster = await rasterizeImageIntersection(src, d, {
      x: bnd.x,
      y: bnd.y,
      width: bnd.width,
      height: bnd.height,
    })
    if (!raster) return null

    return {
      kind: 'image-intersect',
      baseId: imageId,
      image: { href: raster.href, x: bnd.x, y: bnd.y, width: raster.width, height: raster.height, style: { ...src.style } },
      removeIds: operands,
    }
  } finally {
    paper.project.activeLayer.removeChildren()
  }
}
