import { useMemo } from 'react'
import { createShapeOfKind } from '../../model/shapes'
import { geometryBBox } from '../../model/bbox'

// Draw the real shape geometry as a crisp, theme-colored outline. Because it's
// generated from createShapeOfKind, new shapes get a preview automatically — no
// icon wiring needed.
const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  vectorEffect: 'non-scaling-stroke',
  strokeLinejoin: 'round',
  strokeLinecap: 'round',
}

function PreviewShape({ node }) {
  switch (node.type) {
    case 'rect':
      return <rect x={node.x} y={node.y} width={node.width} height={node.height} rx={node.rx || undefined} {...STROKE} />
    case 'ellipse':
      return <ellipse cx={node.cx} cy={node.cy} rx={node.rx} ry={node.ry} {...STROKE} />
    case 'line':
      return <line x1={node.x1} y1={node.y1} x2={node.x2} y2={node.y2} {...STROKE} />
    case 'polygon':
      return <polygon points={node.points.map((p) => p.join(',')).join(' ')} {...STROKE} />
    case 'path':
      return <path d={node.d} {...STROKE} />
    default:
      return null
  }
}

export default function ShapePreview({ kind, size = 28 }) {
  const node = useMemo(() => createShapeOfKind(kind, 0, 0), [kind])
  const b = useMemo(() => geometryBBox(node), [node])
  const pad = (Math.max(b.width, b.height) || 10) * 0.16
  const vb = `${b.x - pad} ${b.y - pad} ${b.width + pad * 2} ${b.height + pad * 2}`
  return (
    <svg viewBox={vb} width={size} height={size} preserveAspectRatio="xMidYMid meet" aria-hidden>
      <PreviewShape node={node} />
    </svg>
  )
}
