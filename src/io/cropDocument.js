import { unionBBox, nodeBounds } from '../model/bbox'
import { translateNode } from '../model/mutate'

/**
 * Build a standalone copy of `doc` that contains only the selected nodes (and,
 * for groups, their descendants), with the page cropped to the selection's
 * bounding box and the artwork shifted so that box sits at the origin. This is
 * how "export just the selection, fit to content" works without touching the
 * live document.
 *
 * The live document is never mutated — it is deep-cloned first. Selected nodes
 * are promoted to top level; because groups carry no transform of their own,
 * detaching a node from its group does not change how it renders. If nothing
 * usable is selected the original doc is returned unchanged.
 */
export function cropDocumentToSelection(doc, ids) {
  const want = new Set((ids || []).filter((id) => doc.nodes[id]))
  if (!want.size) return doc

  // Selected roots in paint order (don't descend past an already-selected root).
  const roots = []
  const collect = (id) => {
    if (want.has(id)) {
      roots.push(id)
      return
    }
    const n = doc.nodes[id]
    if (n && n.type === 'group') n.children.forEach(collect)
  }
  doc.rootOrder.forEach(collect)
  if (!roots.length) return doc

  const box = unionBBox(roots.map((id) => nodeBounds(doc.nodes[id], doc.nodes)))
  if (!box || (box.width <= 0 && box.height <= 0)) return doc

  const clone = JSON.parse(JSON.stringify(doc))

  // Keep only the selected subtrees; drop every other node.
  const keep = new Set()
  const walk = (id) => {
    const n = clone.nodes[id]
    if (!n) return
    keep.add(id)
    if (n.type === 'group') n.children.forEach(walk)
  }
  roots.forEach(walk)
  for (const id of Object.keys(clone.nodes)) {
    if (!keep.has(id)) delete clone.nodes[id]
  }

  // Promote roots to the top level and shift the whole selection so its
  // top-left lands on (0, 0). translateNode recurses into group children.
  clone.rootOrder = roots
  for (const id of roots) {
    clone.nodes[id].parent = null
    translateNode(clone.nodes[id], -box.x, -box.y, clone.nodes)
  }

  clone.page = {
    ...clone.page,
    width: Math.max(1, Math.ceil(box.width)),
    height: Math.max(1, Math.ceil(box.height)),
  }
  // The document background is kept (cropped to the selection's page).

  // Keep the timeline valid: drop clips whose node is no longer present.
  if (clone.animation && Array.isArray(clone.animation.clips)) {
    clone.animation.clips = clone.animation.clips.filter((c) => clone.nodes[c.nodeId])
  }

  return clone
}
