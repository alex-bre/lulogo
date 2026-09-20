import { styleEntries } from '../model/style'
import { nodeTransform } from '../model/transform'
import { textLines, lineStep, lineStartX, widthScaleTransform, ZERO_WIDTH } from '../model/textMetrics'

// Serialize a document to a clean SVG string: minimal attributes, SVG defaults
// omitted (via styleEntries), presentation attributes (no inline style),
// hidden nodes excluded, numbers rounded.

const fmt = (v) => (typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : v)

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function elementName(node) {
  if (node.type === 'polygon') return node.closed ? 'polygon' : 'polyline'
  if (node.type === 'group') return 'g'
  return node.type
}

function geomAttrs(node) {
  switch (node.type) {
    case 'rect': {
      const a = [['x', node.x], ['y', node.y], ['width', node.width], ['height', node.height]]
      if (node.rx) a.push(['rx', node.rx])
      return a
    }
    case 'ellipse':
      return [['cx', node.cx], ['cy', node.cy], ['rx', node.rx], ['ry', node.ry]]
    case 'line':
      return [['x1', node.x1], ['y1', node.y1], ['x2', node.x2], ['y2', node.y2]]
    case 'polygon':
      return [['points', node.points.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(' ')]]
    case 'path':
      return [['d', node.d]]
    case 'image':
      return [['x', node.x], ['y', node.y], ['width', node.width], ['height', node.height], ['href', node.href]]
    case 'text': {
      // No text-anchor: every line carries its own x (see serializeNode), so the
      // export lands identically in any viewer regardless of how it treats the
      // trailing letter-spacing gap.
      const a = [['x', lineStartX(node, textLines(node)[0])], ['y', node.y]]
      a.push(['font-family', node.fontFamily], ['font-size', node.fontSize])
      if (node.fontWeight && node.fontWeight !== 400) a.push(['font-weight', node.fontWeight])
      if (node.fontStyle && node.fontStyle !== 'normal') a.push(['font-style', node.fontStyle])
      if (node.letterSpacing) a.push(['letter-spacing', node.letterSpacing])
      return a
    }
    default:
      return []
  }
}

function serializeNode(node, nodes, pad) {
  if (!node || node.hidden) return ''

  const attrs = [...geomAttrs(node)]
  // Rotation/flip, then (for text) the glyph-width stretch inside it — same
  // order the canvas composes them, so the export matches.
  const t = [nodeTransform(node), node.type === 'text' && widthScaleTransform(node)].filter(Boolean).join(' ')
  if (t) attrs.push(['transform', t])
  for (const e of styleEntries(node.style)) attrs.push(e)
  // Set by the animated export to target nodes from the embedded stylesheet.
  if (node.exportClass) attrs.push(['class', node.exportClass])

  const attrStr = attrs.map(([k, v]) => ` ${k}="${escapeXml(fmt(v))}"`).join('')

  if (node.type === 'group') {
    // A group with no transform/style carries no visual meaning, so flatten it
    // (children inline at this level) to keep the export clean. Groups with a
    // transform or opacity are emitted as <g>.
    if (attrs.length === 0) {
      return node.children
        .map((id) => serializeNode(nodes[id], nodes, pad))
        .filter(Boolean)
        .join('\n')
    }
    const inner = node.children
      .map((id) => serializeNode(nodes[id], nodes, pad + '  '))
      .filter(Boolean)
      .join('\n')
    if (!inner) return ''
    return `${pad}<g${attrStr}>\n${inner}\n${pad}</g>`
  }

  if (node.type === 'text') {
    const lines = textLines(node)
    // A single line is already positioned by the element's own x.
    if (lines.length === 1) return `${pad}<text${attrStr}>${escapeXml(node.text)}</text>`
    // Multi-line: one <tspan> per line, each at its own justified x and shifted
    // a baseline step down. A blank line needs a character for its dy to apply.
    const step = lineStep(node)
    const inner = lines
      .map((line, i) => {
        const dy = i === 0 ? '' : ` dy="${fmt(step)}"`
        return `<tspan x="${fmt(lineStartX(node, line))}"${dy}>${escapeXml(line) || ZERO_WIDTH}</tspan>`
      })
      .join('')
    return `${pad}<text${attrStr}>${inner}</text>`
  }

  return `${pad}<${elementName(node)}${attrStr}/>`
}

// Gradient ids actually referenced by a visible node's fill.
function usedGradientIds(doc) {
  const ids = new Set()
  for (const id in doc.nodes) {
    const n = doc.nodes[id]
    if (n.hidden) continue
    const m = typeof n.style?.fill === 'string' && n.style.fill.match(/^url\(#(.+)\)$/)
    if (m) ids.add(m[1])
  }
  return ids
}

function serializeGradient(g) {
  const stops = g.stops
    .map(
      (s) =>
        `    <stop offset="${fmt(s.offset)}" stop-color="${s.color}"` +
        `${s.opacity != null && s.opacity !== 1 ? ` stop-opacity="${fmt(s.opacity)}"` : ''}/>`,
    )
    .join('\n')
  if (g.type === 'radial') return `  <radialGradient id="${g.id}">\n${stops}\n  </radialGradient>`
  const xf = g.angle ? ` gradientTransform="rotate(${fmt(g.angle)} 0.5 0.5)"` : ''
  return `  <linearGradient id="${g.id}"${xf}>\n${stops}\n  </linearGradient>`
}

export function serializeDocument(doc, { css } = {}) {
  const { width, height } = doc.page
  const parts = []

  const defs = [...usedGradientIds(doc)].map((id) => doc.defs.gradients[id]).filter(Boolean)
  let defsStr = defs.length ? `  <defs>\n${defs.map(serializeGradient).join('\n')}\n  </defs>\n` : ''
  if (css) defsStr += `  <style>\n${css}\n  </style>\n`

  if (doc.background) {
    parts.push(`  <rect width="${fmt(width)}" height="${fmt(height)}" fill="${doc.background}"/>`)
  }
  for (const id of doc.rootOrder) {
    const s = serializeNode(doc.nodes[id], doc.nodes, '  ')
    if (s) parts.push(s)
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(width)} ${fmt(height)}"` +
    ` width="${fmt(width)}" height="${fmt(height)}">\n${defsStr}${parts.join('\n')}\n</svg>\n`
  )
}
