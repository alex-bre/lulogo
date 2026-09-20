import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronsUp,
  ChevronUp,
  ChevronDown,
  ChevronsDown,
  Copy,
  Trash2,
  FileDown,
  ClipboardPaste,
  BoxSelect,
  Paintbrush,
  Pipette,
  Group as GroupIcon,
  Ungroup,
  Hexagon,
  Spline,
} from 'lucide-react'
import { useStore } from '../state/store'
import { useElementSize } from './useElementSize'
import { useViewportControls } from './useViewportControls'
import { useCanvasInteractions, pickSelectable } from './useCanvasInteractions'
import { initInput } from './inputState'
import { computeFit, screenToWorld } from './viewport'
import { selectionBBox } from '../model/bbox'
import { evaluateAnimation } from '../model/animation'
import { importFiles } from '../io/importFile'
import { importClipboardImagesAsync } from '../io/pasteImport'
import { cropDocumentToSelection } from '../io/cropDocument'
import { performConvexHull } from '../geometry/convexHull'
import { isBooleanable } from '../geometry/paperBridge'
import { downloadSvg } from '../io/exportSvg'
import { downloadPng } from '../io/exportPng'
import ContextMenu from '../panels/common/ContextMenu'
import PageFrame from './PageFrame'
import Grid from './Grid'
import Defs from './Defs'
import NodeRenderer from './NodeRenderer'
import SelectionOverlay from './SelectionOverlay'
import Marquee from './Marquee'
import SnapGuides from './SnapGuides'
import InteractionHud from './InteractionHud'
import PenLayer from './PenLayer'
import PathEditLayer from './PathEditLayer'
import Transform3DLayer from './Transform3DLayer'
import TextEditor from './TextEditor'
import ZoomControls from './ZoomControls'
import SvgCodePanel from '../panels/SvgCodePanel'
import styles from './CanvasView.module.css'

/**
 * The central infinite SVG canvas. All artwork lives inside a single transform
 * group (translate + scale = pan/zoom). Page frame, grid, artwork, and the
 * selection/marquee overlays render in world space; the zoom HUD is screen
 * space. Shapes can be dropped onto the canvas from the left palette.
 */
export default function CanvasView() {
  const wrapRef = useRef(null)
  const svgRef = useRef(null)
  const size = useElementSize(wrapRef)

  useViewportControls(svgRef)
  useCanvasInteractions(svgRef)
  useEffect(() => initInput(), [])

  const vp = useStore((s) => s.viewport)
  const doc = useStore((s) => s.document)
  const selection = useStore((s) => s.selection)
  const marquee = useStore((s) => s.ui.marquee)
  const snapGuides = useStore((s) => s.ui.snapGuides)
  const tool = useStore((s) => s.ui.tool)
  const editingId = useStore((s) => s.ui.editingTextId)
  // Re-render text once the bundled fonts have loaded (metrics/weights change).
  useStore((s) => s.ui.fontsVersion)
  const editingPathId = useStore((s) => s.ui.editingPathId)
  const t3d = useStore((s) => s.ui.t3d)
  const anim = useStore((s) => s.ui.anim)
  const hasStyleClip = useStore((s) => s.ui.hasStyleClip)
  const setViewport = useStore((s) => s.setViewport)
  const setCanvasSize = useStore((s) => s.setCanvasSize)

  // While a 3D preview is active its nodes render dimmed under the projection.
  const dimIds = useMemo(() => (t3d ? new Set(t3d.ids) : null), [t3d])

  // Animation preview: per-node overrides at the playhead while playing or
  // scrubbed. Stop clears `previewing`, returning the canvas to design state.
  const animOverrides = useMemo(
    () => (anim.open && anim.previewing ? evaluateAnimation(doc, anim.time) : null),
    [anim.open, anim.previewing, anim.time, doc],
  )

  useEffect(() => setCanvasSize(size), [size, setCanvasSize])

  // Fit the page into view once, after the container is first measured.
  const didFit = useRef(false)
  useEffect(() => {
    if (didFit.current || !size.width || !size.height) return
    didFit.current = true
    setViewport(computeFit(size.width, size.height, doc.page.width, doc.page.height))
  }, [size.width, size.height, doc.page.width, doc.page.height, setViewport])

  const selectionBox = useMemo(() => selectionBBox(doc, selection), [doc, selection])
  const selNodes = useMemo(() => selection.map((id) => doc.nodes[id]).filter(Boolean), [doc, selection])

  const onDragOver = (e) => {
    const types = Array.from(e.dataTransfer.types)
    if (types.includes('application/x-ic-shape') || types.includes('Files')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
  }
  const onDrop = (e) => {
    const r = svgRef.current.getBoundingClientRect()
    const c = screenToWorld(e.clientX - r.left, e.clientY - r.top, useStore.getState().viewport)
    const kind = e.dataTransfer.getData('application/x-ic-shape')
    if (kind) {
      e.preventDefault()
      useStore.getState().addShapeAt(kind, c.x, c.y)
    } else if (e.dataTransfer.files && e.dataTransfer.files.length) {
      e.preventDefault()
      importFiles(e.dataTransfer.files, c)
    }
  }

  // Right-click: select the object under the cursor (or clear on empty space),
  // then open a context menu at the pointer with layer/order + export actions.
  const [ctxMenu, setCtxMenu] = useState(null)
  const onContextMenu = (e) => {
    e.preventDefault()
    const st = useStore.getState()
    const id = pickSelectable(e.target, st.document.nodes, st.selection)
    if (id) {
      if (!st.selection.includes(id)) st.setSelection([id])
    } else {
      st.clearSelection()
    }
    setCtxMenu({ x: e.clientX, y: e.clientY })
  }

  const exportSelection = (fmt) => {
    const st = useStore.getState()
    if (!st.selection.length) return
    const cropped = cropDocumentToSelection(st.document, st.selection)
    const run = fmt === 'png' ? downloadPng(cropped) : downloadSvg(cropped)
    Promise.resolve(run).catch((err) => {
      console.error(err)
      alert(err?.message || 'Export failed')
    })
  }

  const ctxItems = useMemo(() => {
    const st = useStore.getState()
    const hasSel = selection.length > 0
    const hasGroup = selection.some((id) => st.document.nodes[id]?.type === 'group')
    const canConvex = selection.some((id) => isBooleanable(st.document.nodes[id]))
    // Point editing runs on one path at a time; the item toggles the mode.
    const singlePath = selection.length === 1 && st.document.nodes[selection[0]]?.type === 'path'
    const editingPoints = singlePath && editingPathId === selection[0]
    const makeConvex = async () => {
      const cur = useStore.getState()
      const result = await performConvexHull(cur.document, cur.selection)
      if (result) useStore.getState().applyBoolean(result)
    }
    const items = []
    if (hasSel) {
      items.push(
        { label: 'Bring to Front', icon: <ChevronsUp size={14} />, onClick: () => st.reorderNodes(selection, 'front') },
        { label: 'Bring Forward', icon: <ChevronUp size={14} />, onClick: () => st.reorderNodes(selection, 'forward') },
        { label: 'Send Backward', icon: <ChevronDown size={14} />, onClick: () => st.reorderNodes(selection, 'backward') },
        { label: 'Send to Back', icon: <ChevronsDown size={14} />, onClick: () => st.reorderNodes(selection, 'back') },
        { separator: true },
        { label: 'Group', icon: <GroupIcon size={14} />, shortcut: 'Ctrl+G', onClick: () => st.groupSelection() },
        {
          label: 'Ungroup',
          icon: <Ungroup size={14} />,
          shortcut: 'Ctrl+Shift+G',
          disabled: !hasGroup,
          onClick: () => st.ungroupSelection(),
        },
        { separator: true },
        {
          label: editingPoints ? 'Finish Editing Points' : 'Edit Points',
          icon: <Spline size={14} />,
          disabled: !singlePath,
          onClick: () => st.setEditingPath(editingPoints ? null : selection[0]),
        },
        { label: 'Make convex', icon: <Hexagon size={14} />, disabled: !canConvex, onClick: makeConvex },
        { separator: true },
        { label: 'Duplicate', icon: <Copy size={14} />, shortcut: 'Ctrl+D', onClick: () => st.duplicateNodes(selection) },
        { label: 'Delete', icon: <Trash2 size={14} />, shortcut: 'Del', danger: true, onClick: () => st.removeNodes(selection) },
        { separator: true },
        { label: 'Copy Style', icon: <Pipette size={14} />, onClick: () => st.copyStyle() },
        {
          label: 'Paste Style',
          icon: <Paintbrush size={14} />,
          disabled: !hasStyleClip,
          onClick: () => st.pasteStyle(selection),
        },
        { separator: true },
        { label: 'Export Selection as SVG', icon: <FileDown size={14} />, onClick: () => exportSelection('svg') },
        { label: 'Export Selection as PNG', icon: <FileDown size={14} />, onClick: () => exportSelection('png') },
        { separator: true },
      )
    }
    items.push(
      { label: 'Select All', icon: <BoxSelect size={14} />, shortcut: 'Ctrl+A', onClick: () => st.selectAll() },
      {
        label: 'Paste',
        icon: <ClipboardPaste size={14} />,
        shortcut: 'Ctrl+V',
        onClick: async () => {
          // Prefer a clipboard image/SVG; otherwise paste internal objects.
          const imported = await importClipboardImagesAsync().catch(() => false)
          if (!imported) useStore.getState().pasteClipboard()
        },
      },
    )
    return items
  }, [selection, hasStyleClip, editingPathId])

  return (
    <main ref={wrapRef} className={styles.center} onDragOver={onDragOver} onDrop={onDrop}>
      <svg
        ref={svgRef}
        className={styles.svg}
        style={tool === 'pen' ? { cursor: 'crosshair' } : undefined}
        onContextMenu={onContextMenu}
      >
        <Defs gradients={doc.defs.gradients} />
        <g transform={`translate(${vp.panX} ${vp.panY}) scale(${vp.zoom})`}>
          <PageFrame page={doc.page} background={doc.background} />
          {doc.grid.visible && (
            <Grid size={doc.grid.size} zoom={vp.zoom} width={doc.page.width} height={doc.page.height} />
          )}
          {doc.rootOrder.map((id) => (
            <NodeRenderer
              key={id}
              node={doc.nodes[id]}
              nodes={doc.nodes}
              editingId={editingId}
              dimIds={dimIds}
              overrides={animOverrides}
            />
          ))}
          {tool === 'select' && !editingPathId && !t3d && (
            <SelectionOverlay box={selectionBox} zoom={vp.zoom} nodes={selNodes} />
          )}
          <Marquee rect={marquee} />
          <SnapGuides guides={snapGuides} />
          <Transform3DLayer />
          {tool === 'pen' && <PenLayer svgRef={svgRef} />}
          {editingPathId && <PathEditLayer />}
        </g>
      </svg>
      {editingId && <TextEditor />}
      <InteractionHud />
      <ZoomControls size={size} />
      <SvgCodePanel />
      {ctxMenu && (
        <ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={ctxItems} onClose={() => setCtxMenu(null)} />
      )}
    </main>
  )
}
