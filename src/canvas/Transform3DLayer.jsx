import { useEffect, useMemo } from 'react'
import { useStore } from '../state/store'
import { styleAttrs } from '../model/style'
import { makeProjector, cubeCorners, CUBE_FACES, CUBE_EDGES, faceVisibility, wrapAngle } from '../model/projection3d'
import { sessionBounds, nodeSource, projectSource } from '../model/transform3d'
import { extrudeFaces } from '../model/extrude3d'
import { nodeTransform } from '../model/transform'
import styles from './CanvasView.module.css'

/**
 * Live preview for the 3D transform (world space). While a session is active
 * the originals render dimmed (see CanvasView) and this layer draws:
 *  - the projected artwork in its real styles (WYSIWYG),
 *  - a highlighted orientation cube whose front face is the artwork plane
 *    (hidden edges dashed, so depth reads at a glance),
 *  - an angle readout, and
 *  - a transparent hit surface over the cube: drag it to orbit
 *    (useCanvasInteractions routes [data-t3d] pointerdowns here).
 */
export default function Transform3DLayer() {
  const t3d = useStore((s) => s.ui.t3d)
  const doc = useStore((s) => s.document)
  const selection = useStore((s) => s.selection)
  const zoom = useStore((s) => s.viewport.zoom)
  const cancelT3D = useStore((s) => s.cancelT3D)

  // The session is pinned to the selection it started from; end it when the
  // selection changes or its nodes disappear (delete, undo of creation, …).
  const stale = !!t3d && (selection.join('\n') !== t3d.selKey || !t3d.ids.some((id) => doc.nodes[id]))
  useEffect(() => {
    if (stale) cancelT3D()
  }, [stale, cancelT3D])

  const view = useMemo(() => {
    if (!t3d || stale) return null
    const box = sessionBounds(doc, t3d.ids)
    if (!box) return null
    const projector = makeProjector(t3d.params, box)

    const depth = t3d.params.depth || 0
    const shapes = []
    const solids = []
    const images = []
    for (const id of t3d.ids) {
      const n = doc.nodes[id]
      if (!n || n.hidden) continue
      const src = nodeSource(n, t3d.textD)
      if (!src) continue
      if (n.type === 'image') {
        // Images tilt (affine) regardless of thickness; flat in perspective.
        const patch = projectSource(src, projector)
        images.push({
          id,
          href: n.href,
          x: n.x,
          y: n.y,
          width: n.width,
          height: n.height,
          transform: patch ? `matrix(${patch.geom.matrix.join(' ')})` : nodeTransform(n),
        })
      } else if (depth > 0) {
        const faces = extrudeFaces(src, projector, depth, n.style, { flat: t3d.params.flatShade, simple: t3d.params.simple, taper: t3d.params.taper })
        if (faces.length) solids.push({ id, faces, style: styleAttrs(n.style) })
      } else {
        const patch = projectSource(src, projector)
        if (patch) shapes.push({ id, ...patch, attrs: styleAttrs(n.style) })
      }
    }

    // The orbit gizmo matches the extrusion depth so the cube frames the block.
    const gizmoDepth = depth > 0 ? depth : Math.max(16, 0.5 * Math.min(box.width, box.height))
    const corners = cubeCorners(box, gizmoDepth)
    const pts = corners.map(([x, y, z]) => projector.pt(x, y, z))
    const visible = faceVisibility(projector, corners)
    return { shapes, solids, images, pts, visible, params: t3d.params }
  }, [t3d, stale, doc])

  if (!view) return null
  const { shapes, solids, images, pts, visible, params } = view

  const quad = (ids) => ids.map((i, k) => `${k ? 'L' : 'M'} ${pts[i][0]} ${pts[i][1]}`).join(' ') + ' Z'
  const silhouette = CUBE_FACES.map((f) => quad(f.ids)).join(' ')
  const dash = `${4 / zoom} ${4 / zoom}`

  const shapeEl = ({ id, type, geom, attrs }) => {
    if (type === 'line') return <line key={id} x1={geom.x1} y1={geom.y1} x2={geom.x2} y2={geom.y2} {...attrs} />
    if (type === 'polygon') {
      const p = geom.points.map((q) => q.join(',')).join(' ')
      return geom.closed ? <polygon key={id} points={p} {...attrs} /> : <polyline key={id} points={p} {...attrs} />
    }
    return <path key={id} d={geom.d} {...attrs} />
  }

  const label = `X ${Math.round(wrapAngle(params.rx))}°   Y ${Math.round(wrapAngle(params.ry))}°   Z ${Math.round(wrapAngle(params.rz))}°`
  const labelX = pts.reduce((a, p) => a + p[0], 0) / pts.length
  const labelY = Math.max(...pts.map((p) => p[1])) + 20 / zoom

  return (
    <g pointerEvents="none">
      {/* hidden cube edges (behind the artwork) */}
      {CUBE_EDGES.filter(([, , fa, fb]) => !visible[fa] && !visible[fb]).map(([a, b]) => (
        <line
          key={`h${a}-${b}`}
          className={styles.t3dEdgeHidden}
          x1={pts[a][0]}
          y1={pts[a][1]}
          x2={pts[b][0]}
          y2={pts[b][1]}
          strokeDasharray={dash}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {/* soft fills for the visible faces */}
      {CUBE_FACES.map((f, i) =>
        visible[i] ? (
          <path key={`f${i}`} className={f.front ? styles.t3dFaceFront : styles.t3dFace} d={quad(f.ids)} />
        ) : null,
      )}
      {/* the projected artwork (flat), or the extruded solid when thickened */}
      {shapes.map(shapeEl)}
      {images.map((im) => (
        <image
          key={im.id}
          data-t3d-image=""
          href={im.href}
          x={im.x}
          y={im.y}
          width={im.width}
          height={im.height}
          preserveAspectRatio="none"
          transform={im.transform || undefined}
        />
      ))}
      {solids.map((s) => (
        <g key={s.id}>
          {s.faces.map((f, i) =>
            f.role === 'front' ? (
              <path key={i} data-t3d-face="front" d={f.d} {...s.style} />
            ) : (
              // matching hairline stroke closes anti-alias seams between walls
              <path key={i} data-t3d-face={f.role} d={f.d} fill={f.fill} stroke={f.fill} strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ),
          )}
        </g>
      ))}
      {/* visible cube edges */}
      {CUBE_EDGES.filter(([, , fa, fb]) => visible[fa] || visible[fb]).map(([a, b]) => (
        <line
          key={`v${a}-${b}`}
          className={styles.t3dEdge}
          x1={pts[a][0]}
          y1={pts[a][1]}
          x2={pts[b][0]}
          y2={pts[b][1]}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {/* angle readout */}
      <text
        className={styles.t3dLabel}
        x={labelX}
        y={labelY}
        fontSize={11 / zoom}
        textAnchor="middle"
        strokeWidth={3 / zoom}
        style={{ paintOrder: 'stroke' }}
      >
        {label}
      </text>
      {/* orbit hit surface: the cube's whole silhouette */}
      <path d={silhouette} fill="transparent" stroke="none" data-t3d="orbit" pointerEvents="all" style={{ cursor: 'grab' }} />
      {/* click a visible side face to reseat the artwork onto that plane
          (rendered above the orbit surface so a click lands here; a drag on it
          still falls through to the orbit handler in useCanvasInteractions) */}
      {CUBE_FACES.map((f, i) =>
        !f.front && visible[i] ? (
          <path
            key={`hit${i}`}
            className={styles.t3dFaceHit}
            d={quad(f.ids)}
            data-t3d="face"
            data-face={i}
            pointerEvents="all"
            style={{ cursor: 'pointer' }}
          />
        ) : null,
      )}
    </g>
  )
}
