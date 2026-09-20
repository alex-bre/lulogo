import { cloneSubtree } from './mutate'
import { ensureAnimation, genClipId } from './animation'

/**
 * Add everything drawn in `source` on top of `doc`, in place — an immer draft or
 * a plain document alike. Returns the ids of the new top-level nodes, in
 * `source`'s z-order.
 *
 * What comes across is the *artwork*: every top-level layer, group and shape,
 * with its whole subtree, the gradients it paints with, and the animation clips
 * that drive it. Coordinates are page coordinates in both documents and nothing
 * is translated, so each object lands exactly where it sat in its own file.
 *
 * What does not come across is the document's *settings* — page size,
 * background, grid, snapping, the default style for new objects. Those describe
 * the drawing being added to, and it keeps its own.
 *
 * Everything is cloned under fresh ids. Both documents minted their ids
 * independently, and a file merged twice would otherwise collide with itself.
 */
export function mergeDocumentInto(doc, source) {
  const idMap = {}
  const created = []
  for (const rootId of source.rootOrder) {
    const root = source.nodes[rootId]
    if (!root) continue
    const copy = cloneSubtree(root, source.nodes, doc.nodes, source.defs?.gradients, doc.defs.gradients, idMap)
    copy.parent = null
    doc.rootOrder.push(copy.id)
    created.push(copy.id)
  }

  const clips = (source.animation?.clips || []).filter((c) => idMap[c.nodeId])
  if (clips.length) {
    const anim = ensureAnimation(doc)
    let end = 0
    for (const clip of clips) {
      anim.clips.push({ ...JSON.parse(JSON.stringify(clip)), id: genClipId(), nodeId: idMap[clip.nodeId] })
      end = Math.max(end, clip.start + clip.duration)
    }
    // The one setting that does move: a timeline shorter than the clips just
    // added would cut their ends off, and nothing on screen would say why.
    // It only ever grows, and only as far as the new clips need.
    anim.duration = Math.max(anim.duration, end)
  }

  return created
}
