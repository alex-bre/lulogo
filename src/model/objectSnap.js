// Object-to-object edge snapping ("smart guides").
//
// Grid snapping (model/snap.js) rounds coordinates to the grid. This module
// snaps a moving/resizing object's edges and centers to the matching edges and
// centers of *other* objects, and reports the alignment lines to draw so the
// user sees what they're snapping to (the blue guides on the canvas).

/**
 * Collect candidate snap lines from a set of static target boxes. Each vertical
 * line is an x position carrying the y-extent of the box that produced it (so a
 * guide can be drawn spanning that object); each horizontal line is a y position
 * carrying an x-extent. Left/center/right and top/middle/bottom all contribute.
 */
export function collectSnapLines(boxes) {
  const vert = []
  const horz = []
  for (const b of boxes) {
    if (!b) continue
    const x0 = b.x
    const x1 = b.x + b.width
    const y0 = b.y
    const y1 = b.y + b.height
    for (const pos of [x0, (x0 + x1) / 2, x1]) vert.push({ pos, min: y0, max: y1 })
    for (const pos of [y0, (y0 + y1) / 2, y1]) horz.push({ pos, min: x0, max: x1 })
  }
  return { vert, horz }
}

// Closest snap line to any of `edges`, within tolerance `tol`. Returns
// { delta, line } (delta = how far to move the edge to align) or null.
function bestSnap(edges, lines, tol) {
  let best = null
  for (const edge of edges) {
    for (const line of lines) {
      const delta = line.pos - edge
      const ad = Math.abs(delta)
      if (ad <= tol && (!best || ad < best.ad)) best = { delta, ad, line }
    }
  }
  return best
}

/**
 * Snap a moving box (its left/center/right and top/middle/bottom) to the nearest
 * candidate lines. Returns the adjusted top-left {x, y} plus the matched lines
 * (vLine / hLine, or null) for guide drawing.
 */
export function snapBox(box, lines, tol) {
  const vx = bestSnap([box.x, box.x + box.width / 2, box.x + box.width], lines.vert, tol)
  const hy = bestSnap([box.y, box.y + box.height / 2, box.y + box.height], lines.horz, tol)
  return {
    x: box.x + (vx ? vx.delta : 0),
    y: box.y + (hy ? hy.delta : 0),
    vLine: vx ? vx.line : null,
    hLine: hy ? hy.line : null,
  }
}

/**
 * Snap a single dragged point (a resize handle) to nearby object edges on the
 * requested axes only. Returns the adjusted point plus the matched lines.
 */
export function snapPoint(p, lines, tol, hasX, hasY) {
  const vx = hasX ? bestSnap([p.x], lines.vert, tol) : null
  const hy = hasY ? bestSnap([p.y], lines.horz, tol) : null
  return {
    x: vx ? vx.line.pos : p.x,
    y: hy ? hy.line.pos : p.y,
    vLine: vx ? vx.line : null,
    hLine: hy ? hy.line : null,
  }
}

/**
 * Build guide-line descriptors for the matched lines, each extended to span the
 * moving `box` as well as the object it aligned to, so the alignment reads
 * clearly. Orientation 'v' → vertical line at x=pos over [min,max] in y.
 */
export function guidesFor(box, vLine, hLine) {
  const guides = []
  if (vLine) {
    guides.push({
      o: 'v',
      pos: vLine.pos,
      min: Math.min(vLine.min, box.y),
      max: Math.max(vLine.max, box.y + box.height),
    })
  }
  if (hLine) {
    guides.push({
      o: 'h',
      pos: hLine.pos,
      min: Math.min(hLine.min, box.x),
      max: Math.max(hLine.max, box.x + box.width),
    })
  }
  return guides
}
