import { nodeTransform } from '../model/transform'
import { styleAttrs } from '../model/style'
import { geometryBBox } from '../model/bbox'
import { textLines, lineStep, lineStartX, widthScaleTransform, ZERO_WIDTH } from '../model/textMetrics'
import { renderFontFamily, resolveWeight } from '../model/fonts'

/**
 * Render a single document node to SVG. Groups recurse through their children.
 * `data-id` on every element gives us free DOM hit-testing. `editingId` is the
 * text node currently being edited inline (rendered by the HTML overlay
 * instead), so we skip it here. Nodes in `dimIds` render faded — they are the
 * originals behind an active 3D-transform preview. `overrides` is the animation
 * preview: { [nodeId]: { opacity?, transform?, d? } } layered on top of the
 * base artwork (opacity/transform via a wrapper <g>, a morphed `d` replaces the
 * outline) without touching the document.
 */
export default function NodeRenderer({ node, nodes, editingId, dimIds, overrides }) {
  if (!node || node.hidden || node.id === editingId) return null
  if (dimIds && dimIds.has(node.id)) {
    return (
      <g opacity={0.15}>
        <NodeRenderer node={node} nodes={nodes} editingId={editingId} overrides={overrides} />
      </g>
    )
  }

  const ov = overrides ? overrides[node.id] : null
  const content = renderShape(node, nodes, editingId, dimIds, overrides, ov)
  if (ov && (ov.opacity != null || ov.transform)) {
    return (
      <g opacity={ov.opacity} transform={ov.transform || undefined}>
        {content}
      </g>
    )
  }
  return content
}

function renderShape(node, nodes, editingId, dimIds, overrides, ov) {
  const common = { 'data-id': node.id, transform: nodeTransform(node) }
  const style = styleAttrs(node.style)

  // A morph override replaces the outline of any morphable shape with a path.
  if (ov && ov.d && (node.type === 'rect' || node.type === 'ellipse' || node.type === 'polygon' || node.type === 'path')) {
    return <path {...common} d={ov.d} {...style} />
  }

  switch (node.type) {
    case 'rect':
      return (
        <rect
          {...common}
          x={node.x}
          y={node.y}
          width={node.width}
          height={node.height}
          rx={node.rx || undefined}
          {...style}
        />
      )
    case 'ellipse':
      return <ellipse {...common} cx={node.cx} cy={node.cy} rx={node.rx} ry={node.ry} {...style} />
    case 'line':
      // Visible stroke + a wide transparent hit stroke (non-scaling, so the
      // clickable area stays ~14px at any zoom — thin lines are easy to grab).
      return (
        <g {...common}>
          <line x1={node.x1} y1={node.y1} x2={node.x2} y2={node.y2} pointerEvents="none" {...style} />
          <line
            x1={node.x1}
            y1={node.y1}
            x2={node.x2}
            y2={node.y2}
            stroke="transparent"
            strokeWidth={14}
            fill="none"
            vectorEffect="non-scaling-stroke"
            pointerEvents="stroke"
          />
        </g>
      )
    case 'polygon': {
      const pts = node.points.map((p) => p.join(',')).join(' ')
      return node.closed ? (
        <polygon {...common} points={pts} {...style} />
      ) : (
        <polyline {...common} points={pts} {...style} />
      )
    }
    case 'path':
      return <path {...common} d={node.d} {...style} />
    case 'image':
      // Spread style so opacity (and any other style) applies, matching the SVG
      // exporter; fill/stroke are inert on a raster <image>.
      return (
        <image
          {...common}
          x={node.x}
          y={node.y}
          width={node.width}
          height={node.height}
          href={node.href}
          preserveAspectRatio="none"
          {...style}
        />
      )
    case 'text': {
      // Transparent bbox rect makes the whole text block easy to click.
      const b = geometryBBox(node)
      const lines = textLines(node)
      const step = lineStep(node)
      return (
        <g {...common}>
          <rect x={b.x} y={b.y} width={b.width} height={b.height} fill="transparent" pointerEvents="all" />
          <text
            x={node.x}
            y={node.y}
            // Stretches the glyphs horizontally about the anchor; the lines below
            // are placed at their natural x, so this scales them into place.
            transform={widthScaleTransform(node) || undefined}
            fontFamily={renderFontFamily(node.fontFamily)}
            fontSize={node.fontSize}
            fontWeight={resolveWeight(node.fontFamily, node.fontWeight)}
            fontStyle={node.fontStyle}
            letterSpacing={node.letterSpacing || undefined}
            pointerEvents="none"
            {...style}
          >
            {/* Each line is placed at its own x with the default (start) anchor
                — see lineStartX: relying on text-anchor would hand alignment to
                the engine, which disagrees across browsers once letter-spacing
                is in play. */}
            {lines.map((line, i) => (
              // A blank line still needs a character for its `dy` to apply.
              <tspan key={i} x={lineStartX(node, line)} dy={i === 0 ? 0 : step}>
                {line || ZERO_WIDTH}
              </tspan>
            ))}
          </text>
        </g>
      )
    }
    case 'group':
      return (
        <g {...common}>
          {node.children.map((id) => (
            <NodeRenderer
              key={id}
              node={nodes[id]}
              nodes={nodes}
              editingId={editingId}
              dimIds={dimIds}
              overrides={overrides}
            />
          ))}
        </g>
      )
    default:
      return null
  }
}
