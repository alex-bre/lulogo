// Small read helpers for the property panels.

export function selectedNodes(doc, selection) {
  return selection.map((id) => doc.nodes[id]).filter(Boolean)
}

/**
 * Expand a selection to its leaf node ids (descending into groups). Lets a
 * group selection drive the same per-object controls as a multi-selection.
 */
export function selectionLeaves(doc, selection) {
  const out = []
  const walk = (id) => {
    const n = doc.nodes[id]
    if (!n) return
    if (n.type === 'group') n.children.forEach(walk)
    else out.push(id)
  }
  selection.forEach(walk)
  return out
}

export function selectedLeafNodes(doc, selection) {
  return selectionLeaves(doc, selection).map((id) => doc.nodes[id])
}

/** Returns the shared value of getter(node) across nodes, or null if mixed/empty. */
export function common(nodes, getter) {
  if (!nodes.length) return null
  const first = getter(nodes[0])
  for (let i = 1; i < nodes.length; i++) {
    if (getter(nodes[i]) !== first) return null
  }
  return first
}

export function commonStyle(nodes, key) {
  return common(nodes, (n) => (n.style ? n.style[key] : undefined))
}
