// Convert pen-tool anchors into SVG path data. Each anchor is
// { x, y, hIn?: {x,y}, hOut?: {x,y} } where the handles are absolute control
// points; a segment is cubic when either endpoint has a handle, else a line.

const r = (n) => Math.round(n * 100) / 100

function segment(p0, p1) {
  if (p0.hOut || p1.hIn) {
    const c1 = p0.hOut || p0
    const c2 = p1.hIn || p1
    return ` C ${r(c1.x)} ${r(c1.y)} ${r(c2.x)} ${r(c2.y)} ${r(p1.x)} ${r(p1.y)}`
  }
  return ` L ${r(p1.x)} ${r(p1.y)}`
}

export function anchorsToPath(anchors, closed) {
  if (!anchors.length) return ''
  let d = `M ${r(anchors[0].x)} ${r(anchors[0].y)}`
  for (let k = 1; k < anchors.length; k++) d += segment(anchors[k - 1], anchors[k])
  if (closed && anchors.length > 1) {
    d += segment(anchors[anchors.length - 1], anchors[0])
    d += ' Z'
  }
  return d
}
