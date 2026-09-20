import { useEffect } from 'react'
import { useStore } from '../state/store'
import { beginHistoryBatch, endHistoryBatch } from '../state/history'
import { screenToWorld } from './viewport'
import { input } from './inputState'
import { snapValue, rectsIntersect } from '../model/snap'
import { collectSnapLines, snapBox, snapPoint, guidesFor } from '../model/objectSnap'
import { selectionBBox, nodeBounds, geometryBBox, nodeCenter } from '../model/bbox'
import { scaleNode, translateNode } from '../model/mutate'
import { parsePath, serializeSubpaths, insertAnchor } from '../model/pathEdit'
import { faceViewParams } from '../model/projection3d'

// The transform frame of a node (rotation + flip about its geometry center),
// used to map world pointer coordinates into the path's local `d` space.
function nodeFrame(node) {
  const b = geometryBBox(node)
  return {
    c: { x: b.x + b.width / 2, y: b.y + b.height / 2 },
    deg: node.rotation || 0,
    fx: node.flipX ? -1 : 1,
    fy: node.flipY ? -1 : 1,
  }
}
function worldToLocal(p, f) {
  const rad = (-f.deg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dx = p.x - f.c.x
  const dy = p.y - f.c.y
  const rx = f.c.x + dx * cos - dy * sin
  const ry = f.c.y + dx * sin + dy * cos
  return { x: f.c.x + (rx - f.c.x) * f.fx, y: f.c.y + (ry - f.c.y) * f.fy }
}

// The node id actually drawn under the pointer — no climbing, so this is the
// leaf shape even when it lives deep inside groups.
function leafId(target, nodes) {
  const el = target.closest && target.closest('[data-id]')
  if (!el) return null
  const id = el.getAttribute('data-id')
  return nodes[id] ? id : null
}

// Resolve the selectable node id for a pointer target: the leaf under the
// pointer, then climb to its top-level ancestor (so clicking inside a group
// selects the group). Groups in `open` are climbed *into* instead of past —
// that is how a group entered by double-click keeps taking direct clicks.
export function pickId(target, nodes, open) {
  let id = leafId(target, nodes)
  if (!id) return null
  while (nodes[id].parent && nodes[nodes[id].parent] && !(open && open.has(nodes[id].parent)))
    id = nodes[id].parent
  return id
}

// What a click should select, given what is selected now: the top-level object,
// unless the selection has already been drilled into the group it belongs to.
export function pickSelectable(target, nodes, selection) {
  return pickId(target, nodes, openGroups(nodes, selection))
}

// Ancestor ids of `id`, outermost first, with `id` itself last.
function ancestorChain(id, nodes) {
  const chain = []
  for (let cur = id; nodes[cur]; cur = nodes[cur].parent) chain.unshift(cur)
  return chain
}

// The groups the current selection sits inside. Clicks land directly on their
// members rather than re-selecting the whole group.
function openGroups(nodes, selection) {
  const open = new Set()
  for (const id of selection) {
    if (!nodes[id]) continue
    for (let p = nodes[id].parent; nodes[p]; p = nodes[p].parent) open.add(p)
  }
  return open
}

const OPPOSITE = { nw: 'se', ne: 'sw', se: 'nw', sw: 'ne', n: 's', s: 'n', e: 'w', w: 'e' }

// Named point on a bbox ('nw'..'se', edges, center for missing axis).
function bboxPoint(box, pos) {
  const x = pos.includes('w') ? box.x : pos.includes('e') ? box.x + box.width : box.x + box.width / 2
  const y = pos.includes('n') ? box.y : pos.includes('s') ? box.y + box.height : box.y + box.height / 2
  return { x, y }
}

const clampScale = (s) => Math.max(0.01, Math.abs(s))

// Snap distance for object-edge alignment, in screen pixels (÷ zoom for world).
const SNAP_TOL_PX = 6

// Alignment lines from every top-level object except those in `excludeIds`.
function targetSnapLines(doc, excludeIds) {
  const skip = new Set(excludeIds)
  const boxes = doc.rootOrder
    .filter((id) => !skip.has(id) && doc.nodes[id] && !doc.nodes[id].hidden)
    .map((id) => nodeBounds(doc.nodes[id], doc.nodes))
    .filter(Boolean)
  return collectSnapLines(boxes)
}

// World position of a local point under a node's transform: flip about the
// center, then rotate about the center (matches nodeTransform's order).
function applyNodeTransformPoint(p, c, deg, fx, fy) {
  const x = c.x + (p.x - c.x) * fx
  const y = c.y + (p.y - c.y) * fy
  const r = (deg * Math.PI) / 180
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  const dx = x - c.x
  const dy = y - c.y
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos }
}

/**
 * Left-button canvas interactions: select (click / ctrl-toggle), move the
 * selection (with snapping), and marquee box-select on empty space. Pan
 * (middle / Space) is handled separately by useViewportControls.
 */
export function useCanvasInteractions(svgRef) {
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return

    const toSvg = (e) => {
      const r = svg.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }

    const worldOf = (e) => {
      const s = toSvg(e)
      return screenToWorld(s.x, s.y, useStore.getState().viewport)
    }
    const snapWorld = (e) => {
      const w = worldOf(e)
      const d = useStore.getState().document
      return { x: snapValue(w.x, d.snapping, d.grid), y: snapValue(w.y, d.snapping, d.grid) }
    }
    const clearDragFeedback = () => {
      useStore.getState().setSnapGuides([])
      useStore.getState().setHud(null)
    }
    const dragWith = (move) => {
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        clearDragFeedback()
        endHistoryBatch()
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    }

    const onPointerDown = (e) => {
      if (e.button !== 0 || input.space) return // left only; Space = pan
      const tool = useStore.getState().ui.tool
      if (tool === 'pen') return // PenLayer handles its own input
      if (tool === 'text') {
        const st = useStore.getState()
        const id = pickId(e.target, st.document.nodes)
        beginHistoryBatch() // ended by TextEditor.finish — place+type is one undo
        if (id && st.document.nodes[id].type === 'text') {
          st.setSelection([id])
          st.setEditingText(id)
        } else {
          const p = snapWorld(e)
          st.addTextAt(p.x, p.y)
        }
        return
      }

      // Path point-edit mode: anchors / handles / segments take priority.
      const editId = useStore.getState().ui.editingPathId
      if (editId && useStore.getState().document.nodes[editId]) {
        const pt = e.target.closest && e.target.closest('[data-pathpt]')
        if (pt) {
          e.preventDefault()
          const kind = pt.getAttribute('data-pathpt')
          const sp = parseInt(pt.getAttribute('data-sp'), 10)
          const ai = parseInt(pt.getAttribute('data-ai'), 10)
          if (kind === 'anchor') return beginAnchorDrag(editId, sp, ai, e)
          if (kind === 'handle') return beginHandleDrag(editId, sp, ai, pt.getAttribute('data-h'), e)
          if (kind === 'segment') return beginSegmentInsert(editId, sp, ai, e)
          return
        }
        // Clicked away from any point: leave edit mode, then select normally.
        useStore.getState().setEditingPath(null)
      }

      // Selection-overlay handles take priority over hit-testing the artwork.
      const handle = e.target.closest && e.target.closest('[data-handle]')
      if (handle) {
        const kind = handle.getAttribute('data-handle')
        if (kind === 'resize') return beginResize(e, handle.getAttribute('data-pos'))
        if (kind === 'rotate') return beginRotate(e)
        if (kind === 'endpoint')
          return beginEndpoint(handle.getAttribute('data-id'), parseInt(handle.getAttribute('data-which'), 10))
      }

      // 3D-preview cube: drag to orbit (Shift = 15° steps, Alt = spin Z); a
      // click on a side face (no drag) reseats the artwork onto that plane.
      const t3d = e.target.closest && e.target.closest('[data-t3d]')
      if (t3d && useStore.getState().ui.t3d) {
        const faceIndex = t3d.getAttribute('data-t3d') === 'face' ? parseInt(t3d.getAttribute('data-face'), 10) : null
        return beginOrbit3D(e, faceIndex)
      }

      const st = useStore.getState()
      const id = pickSelectable(e.target, st.document.nodes, st.selection)
      const additive = e.ctrlKey || e.metaKey || e.shiftKey

      if (id && !st.document.nodes[id].locked) {
        if (additive) {
          st.toggleSelection(id)
          if (useStore.getState().selection.includes(id)) beginMove(e)
        } else {
          if (!st.selection.includes(id)) st.setSelection([id])
          beginMove(e)
        }
      } else {
        beginMarquee(e, additive)
      }
    }

    function beginMove(e) {
      const ids = [...useStore.getState().selection]
      const vp = useStore.getState().viewport
      const doc0 = useStore.getState().document
      const startBox = selectionBBox(doc0, ids)
      if (!startBox) return
      const lines = targetSnapLines(doc0, ids)
      const tol = SNAP_TOL_PX / vp.zoom
      beginHistoryBatch()
      const start = { x: e.clientX, y: e.clientY }
      let last = { dx: 0, dy: 0 }

      const move = (ev) => {
        const rawDx = (ev.clientX - start.x) / vp.zoom
        const rawDy = (ev.clientY - start.y) / vp.zoom
        const d = useStore.getState().document
        // Grid-snapped baseline, then object-edge snapping overrides it where a
        // nearby object edge/center lines up (unless Alt bypasses snapping).
        const box = {
          x: snapValue(startBox.x + rawDx, d.snapping, d.grid),
          y: snapValue(startBox.y + rawDy, d.snapping, d.grid),
          width: startBox.width,
          height: startBox.height,
        }
        const snapped = ev.altKey ? { ...box, vLine: null, hLine: null } : snapBox(box, lines, tol)
        useStore.getState().setSnapGuides(guidesFor({ ...box, x: snapped.x, y: snapped.y }, snapped.vLine, snapped.hLine))
        useStore.getState().setHud({ kind: 'move', x: snapped.x, y: snapped.y })
        const tx = snapped.x - startBox.x
        const ty = snapped.y - startBox.y
        const ddx = tx - last.dx
        const ddy = ty - last.dy
        if (ddx || ddy) {
          useStore.getState().translateNodes(ids, ddx, ddy)
          last = { dx: tx, dy: ty }
        }
      }
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        clearDragFeedback()
        endHistoryBatch()
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    }

    function beginMarquee(e, additive) {
      const vp = useStore.getState().viewport
      const p0 = screenToWorld(toSvg(e).x, toSvg(e).y, vp)
      const prevSel = [...useStore.getState().selection]
      let moved = false

      const move = (ev) => {
        const p = screenToWorld(toSvg(ev).x, toSvg(ev).y, vp)
        const rect = {
          x: Math.min(p0.x, p.x),
          y: Math.min(p0.y, p.y),
          width: Math.abs(p.x - p0.x),
          height: Math.abs(p.y - p0.y),
        }
        if (rect.width > 2 / vp.zoom || rect.height > 2 / vp.zoom) moved = true
        const st = useStore.getState()
        st.setMarquee(rect)
        const d = st.document
        const hits = d.rootOrder.filter((id) => {
          const n = d.nodes[id]
          if (!n || n.hidden || n.locked) return false
          const b = nodeBounds(n, d.nodes)
          return b && rectsIntersect(b, rect)
        })
        st.setSelection(additive ? Array.from(new Set([...prevSel, ...hits])) : hits)
      }
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        useStore.getState().setMarquee(null)
        if (!moved && !additive) useStore.getState().clearSelection()
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    }

    function beginResize(e, pos) {
      const st = useStore.getState()
      const sel = st.selection
      // Rotated/flipped single objects resize in their own frame so the
      // opposite corner stays put.
      const single = sel.length === 1 ? st.document.nodes[sel[0]] : null
      if (single && single.type !== 'group' && (single.rotation || single.flipX || single.flipY)) {
        beginRotatedResize(e, pos, single)
        return
      }
      const box0 = selectionBBox(st.document, sel)
      if (!box0) return
      const lines = targetSnapLines(st.document, sel)
      const tol = SNAP_TOL_PX / st.viewport.zoom
      beginHistoryBatch()
      const anchor = bboxPoint(box0, OPPOSITE[pos])
      const startHandle = bboxPoint(box0, pos)
      const hasX = pos.includes('e') || pos.includes('w')
      const hasY = pos.includes('n') || pos.includes('s')
      const denomX = startHandle.x - anchor.x
      const denomY = startHandle.y - anchor.y
      let last = { sx: 1, sy: 1 }
      dragWith((ev) => {
        const gp = snapWorld(ev)
        // Snap the dragged corner/edge to nearby object edges. Aspect-lock
        // (Shift) and snap-bypass (Alt) fall back to the grid-snapped pointer.
        const s = ev.shiftKey || ev.altKey ? { ...gp, vLine: null, hLine: null } : snapPoint(gp, lines, tol, hasX, hasY)
        let sx = hasX && denomX !== 0 ? (s.x - anchor.x) / denomX : 1
        let sy = hasY && denomY !== 0 ? (s.y - anchor.y) / denomY : 1
        if (ev.shiftKey && hasX && hasY) {
          const m = Math.max(Math.abs(sx), Math.abs(sy))
          sx = m
          sy = m
        }
        sx = clampScale(sx)
        sy = clampScale(sy)
        const dSx = sx / last.sx
        const dSy = sy / last.sy
        if (dSx !== 1 || dSy !== 1) {
          useStore.getState().scaleSelectionBy(anchor.x, anchor.y, dSx, dSy)
          last = { sx, sy }
        }
        const nb = selectionBBox(useStore.getState().document, sel)
        if (nb) {
          useStore.getState().setHud({ kind: 'resize', width: nb.width, height: nb.height })
          useStore.getState().setSnapGuides(guidesFor(nb, s.vLine, s.hLine))
        }
      })
    }

    // Resize a single rotated/flipped node: solve the scale in the node's local
    // frame (so the dragged handle follows the pointer) while pinning the
    // opposite corner's world position. Recomputed from a snapshot each move.
    function beginRotatedResize(e, pos, liveNode) {
      const node0 = JSON.parse(JSON.stringify(liveNode))
      const id = node0.id
      const deg = node0.rotation || 0
      const fx = node0.flipX ? -1 : 1
      const fy = node0.flipY ? -1 : 1
      const lb = geometryBBox(node0)
      const anchorLocal = bboxPoint(lb, OPPOSITE[pos])
      const handleLocal = bboxPoint(lb, pos)
      const c0 = { x: lb.x + lb.width / 2, y: lb.y + lb.height / 2 }
      const wFix = applyNodeTransformPoint(anchorLocal, c0, deg, fx, fy)
      const v = { x: handleLocal.x - anchorLocal.x, y: handleLocal.y - anchorLocal.y }
      const rad = (-deg * Math.PI) / 180
      const cos = Math.cos(rad)
      const sin = Math.sin(rad)
      const hasX = pos.includes('e') || pos.includes('w')
      const hasY = pos.includes('n') || pos.includes('s')
      beginHistoryBatch()
      dragWith((ev) => {
        const p = snapWorld(ev)
        const dx = p.x - wFix.x
        const dy = p.y - wFix.y
        const ux = dx * cos - dy * sin // pointer in the node's local frame
        const uy = dx * sin + dy * cos
        let sx = hasX && v.x !== 0 ? ux / (fx * v.x) : 1
        let sy = hasY && v.y !== 0 ? uy / (fy * v.y) : 1
        if (ev.shiftKey && hasX && hasY) {
          const m = Math.max(Math.abs(sx), Math.abs(sy))
          sx = m
          sy = m
        }
        sx = clampScale(sx)
        sy = clampScale(sy)
        const node = JSON.parse(JSON.stringify(node0))
        scaleNode(node, anchorLocal.x, anchorLocal.y, sx, sy, {})
        // Re-pin the anchor: translate so its post-rotation world point == wFix.
        const cNew = nodeCenter(node)
        const mapped = applyNodeTransformPoint(anchorLocal, cNew, node.rotation, node.flipX ? -1 : 1, node.flipY ? -1 : 1)
        translateNode(node, wFix.x - mapped.x, wFix.y - mapped.y, {})
        useStore.getState().replaceNode(id, node)
        // Preview the object's own (unrotated) size. Object-edge guides are
        // skipped here: a rotated frame doesn't align to axis-aligned edges.
        const gb = geometryBBox(node)
        useStore.getState().setHud({ kind: 'resize', width: gb.width, height: gb.height })
      })
    }

    // Orbit the 3D-transform preview by dragging its cube. Screen-space deltas
    // map to angles (X follows vertical drag, Y horizontal; Alt spins Z). The
    // document is untouched — only ui.t3d.params change — so no history batch.
    // When the pointer went down on a side face (faceIndex != null), a release
    // without a real drag reseats the artwork onto that face's plane instead.
    function beginOrbit3D(e, faceIndex = null) {
      e.preventDefault()
      const p0 = { ...useStore.getState().ui.t3d.params }
      const start = { x: e.clientX, y: e.clientY }
      const SPEED = 0.35 // degrees per screen pixel
      const THRESH = 4 // px before a press counts as an orbit drag (vs. a click)
      const wrap = (a) => (((a + 180) % 360 + 360) % 360) - 180
      let dragging = false
      const move = (ev) => {
        if (!useStore.getState().ui.t3d) return
        const dxPx = ev.clientX - start.x
        const dyPx = ev.clientY - start.y
        if (!dragging && Math.hypot(dxPx, dyPx) < THRESH) return
        dragging = true
        const dx = dxPx * SPEED
        const dy = dyPx * SPEED
        let next = ev.altKey
          ? { rx: p0.rx, ry: p0.ry, rz: p0.rz + dx }
          : { rx: p0.rx + dy, ry: p0.ry + dx, rz: p0.rz }
        if (ev.shiftKey) {
          next = {
            rx: Math.round(next.rx / 15) * 15,
            ry: Math.round(next.ry / 15) * 15,
            rz: Math.round(next.rz / 15) * 15,
          }
        }
        useStore.getState().setT3DParams({ rx: wrap(next.rx), ry: wrap(next.ry), rz: wrap(next.rz) })
      }
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        if (!dragging && faceIndex != null && useStore.getState().ui.t3d) {
          useStore.getState().setT3DParams(faceViewParams(faceIndex, p0))
        }
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    }

    function beginRotate(e) {
      const box0 = selectionBBox(useStore.getState().document, useStore.getState().selection)
      if (!box0) return
      beginHistoryBatch()
      const cx = box0.x + box0.width / 2
      const cy = box0.y + box0.height / 2
      const w0 = worldOf(e)
      let lastAngle = (Math.atan2(w0.y - cy, w0.x - cx) * 180) / Math.PI
      dragWith((ev) => {
        const w = worldOf(ev)
        let ang = (Math.atan2(w.y - cy, w.x - cx) * 180) / Math.PI
        if (ev.shiftKey) ang = Math.round(ang / 15) * 15
        const delta = ang - lastAngle
        if (delta) {
          useStore.getState().rotateSelectionBy(cx, cy, delta)
          lastAngle = ang
        }
      })
    }

    function beginEndpoint(id, which) {
      beginHistoryBatch()
      dragWith((ev) => {
        const p = snapWorld(ev)
        useStore.getState().setLineEndpoint(id, which, p.x, p.y)
      })
    }

    // ---- path point editing ----
    // Move an anchor (and its bezier handles) to follow the pointer.
    function beginAnchorDrag(id, sp, ai, e) {
      const st = useStore.getState()
      if (e.altKey) return st.deletePathPoint(id, sp, ai) // Alt-click removes it
      st.setActiveAnchor({ sp, ai })
      const node = st.document.nodes[id]
      const frame = nodeFrame(node)
      const subs = parsePath(node.d)
      const anchor = subs[sp] && subs[sp].anchors[ai]
      if (!anchor) return
      const start = { ...anchor, hIn: anchor.hIn && { ...anchor.hIn }, hOut: anchor.hOut && { ...anchor.hOut } }
      beginHistoryBatch()
      dragWith((ev) => {
        const loc = worldToLocal(snapWorld(ev), frame)
        const dx = loc.x - start.x
        const dy = loc.y - start.y
        const a = subs[sp].anchors[ai]
        a.x = start.x + dx
        a.y = start.y + dy
        if (start.hIn) a.hIn = { x: start.hIn.x + dx, y: start.hIn.y + dy }
        if (start.hOut) a.hOut = { x: start.hOut.x + dx, y: start.hOut.y + dy }
        useStore.getState().setPathData(id, serializeSubpaths(subs))
      })
    }

    // Drag one bezier control handle of an anchor.
    function beginHandleDrag(id, sp, ai, which, e) {
      const st = useStore.getState()
      st.setActiveAnchor({ sp, ai })
      const node = st.document.nodes[id]
      const frame = nodeFrame(node)
      const subs = parsePath(node.d)
      if (!subs[sp] || !subs[sp].anchors[ai]) return
      beginHistoryBatch()
      dragWith((ev) => {
        const loc = worldToLocal(snapWorld(ev), frame)
        const a = subs[sp].anchors[ai]
        if (which === 'in') a.hIn = { x: loc.x, y: loc.y }
        else a.hOut = { x: loc.x, y: loc.y }
        useStore.getState().setPathData(id, serializeSubpaths(subs))
      })
    }

    // Insert a point on a segment at the click position, then drag it.
    function beginSegmentInsert(id, sp, ai, e) {
      const st = useStore.getState()
      const node = st.document.nodes[id]
      const frame = nodeFrame(node)
      const loc0 = worldToLocal(snapWorld(e), frame)
      const res = insertAnchor(parsePath(node.d), sp, ai, loc0)
      const subs = res.subs
      const newAi = res.ai
      st.setActiveAnchor({ sp, ai: newAi })
      beginHistoryBatch()
      st.setPathData(id, serializeSubpaths(subs))
      const anchor = subs[sp].anchors[newAi]
      const start = { ...anchor, hIn: anchor.hIn && { ...anchor.hIn }, hOut: anchor.hOut && { ...anchor.hOut } }
      dragWith((ev) => {
        const loc = worldToLocal(snapWorld(ev), frame)
        const dx = loc.x - start.x
        const dy = loc.y - start.y
        const a = subs[sp].anchors[newAi]
        a.x = start.x + dx
        a.y = start.y + dy
        if (start.hIn) a.hIn = { x: start.hIn.x + dx, y: start.hIn.y + dy }
        if (start.hOut) a.hOut = { x: start.hOut.x + dx, y: start.hOut.y + dy }
        useStore.getState().setPathData(id, serializeSubpaths(subs))
      })
    }

    // Double-click (in select mode): step one level into a group, selecting the
    // object under the pointer. Once the leaf itself is selected a further
    // double-click edits a text node inline. (Path point editing lives in the
    // context menu — see CanvasView's "Edit points".)
    const onDblClick = (e) => {
      const st = useStore.getState()
      if (st.ui.tool !== 'select') return
      const leaf = leafId(e.target, st.document.nodes)
      if (!leaf) return
      const chain = ancestorChain(leaf, st.document.nodes)
      // Descend from the outermost selected node in the chain — the pointerdown
      // that opened this double-click already selected it.
      const at = chain.findIndex((id) => st.selection.includes(id))
      const next = chain[(at < 0 ? 0 : at) + 1]
      if (next) {
        if (!st.document.nodes[next].locked) st.setSelection([next])
        return
      }
      const node = st.document.nodes[leaf]
      if (node.type === 'text' && !node.locked) {
        beginHistoryBatch() // ended by TextEditor.finish
        st.setSelection([leaf])
        st.setEditingText(leaf)
      }
    }

    svg.addEventListener('pointerdown', onPointerDown)
    svg.addEventListener('dblclick', onDblClick)
    return () => {
      svg.removeEventListener('pointerdown', onPointerDown)
      svg.removeEventListener('dblclick', onDblClick)
    }
  }, [svgRef])
}
