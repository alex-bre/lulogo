import { useEffect, useRef } from 'react'
import { useStore } from '../state/store'
import { endHistoryBatch } from '../state/history'
import { worldToScreen } from './viewport'
import { geometryBBox } from '../model/bbox'
import { lineHeightOf, letterSpacingOf, textWidth, widthScaleOf, ANCHOR_FRAC } from '../model/textMetrics'
import { renderFontFamily, resolveWeight } from '../model/fonts'
import styles from './CanvasView.module.css'

/**
 * Inline text editor: an HTML textarea overlaid (screen space) on the text node
 * being edited, with matching font/size/color. The underlying SVG text is
 * skipped by NodeRenderer while editing. Its box tracks the node's measured
 * bounds, so it hugs the text instead of using the browser's default field
 * width. Enter inserts a line break; Escape (or clicking away) commits, and an
 * empty result deletes the node. Returns to the select tool afterwards.
 */
export default function TextEditor() {
  const id = useStore((s) => s.ui.editingTextId)
  const node = useStore((s) => (id ? s.document.nodes[id] : null))
  const vp = useStore((s) => s.viewport)
  const setTextContent = useStore((s) => s.setTextContent)
  const setEditingText = useStore((s) => s.setEditingText)
  const setTool = useStore((s) => s.setTool)
  const removeNodes = useStore((s) => s.removeNodes)
  const inputRef = useRef(null)

  // Focus + select on mount/target change (more reliable than autoFocus for a
  // field mounted from a native pointer handler).
  useEffect(() => {
    const el = inputRef.current
    if (el) {
      el.focus()
      el.select()
    }
  }, [id])

  if (!node || node.type !== 'text') return null
  const b = geometryBBox(node)
  // The textarea is laid out at *natural* width and stretched with a CSS scaleX
  // about the anchor (below), mirroring how the canvas <text> is scaled — so the
  // field tracks the glyphs at any widthScale. Its top/height are the real box.
  const frac = ANCHOR_FRAC[node.align] ?? 0
  const naturalWidth = textWidth(node)
  const tl = worldToScreen(node.x - frac * naturalWidth, b.y, vp)

  const finish = () => {
    const cur = useStore.getState().document.nodes[id]
    setEditingText(null)
    setTool('select')
    if (cur && !cur.text.trim()) removeNodes([id])
    endHistoryBatch() // matches the beginHistoryBatch when editing started
  }

  return (
    <textarea
      ref={inputRef}
      className={styles.textEditor}
      defaultValue={node.text}
      spellCheck={false}
      rows={1}
      wrap="off"
      style={{
        left: tl.x,
        top: tl.y,
        // Natural width (the scaleX below stretches it). CSS letter-spacing adds
        // a trailing gap after the last glyph that our metrics deliberately
        // ignore (see textMetrics.lineWidth), so widen the field by exactly one
        // gap: the browser then centers/right-aligns each line where the canvas
        // draws it. It doubles as caret room past the last glyph.
        width: Math.max(naturalWidth * vp.zoom, 8) + letterSpacingOf(node) * vp.zoom + 1,
        height: b.height * vp.zoom,
        // Stretch the glyphs horizontally about the anchor, matching the canvas.
        transform: widthScaleOf(node) === 1 ? undefined : `scaleX(${widthScaleOf(node)})`,
        transformOrigin: `${frac * naturalWidth * vp.zoom}px 0`,
        fontFamily: renderFontFamily(node.fontFamily),
        fontSize: node.fontSize * vp.zoom,
        fontWeight: resolveWeight(node.fontFamily, node.fontWeight),
        fontStyle: node.fontStyle,
        letterSpacing: letterSpacingOf(node) * vp.zoom,
        lineHeight: lineHeightOf(node),
        color: node.style?.fill || '#000',
        textAlign: node.align === 'middle' ? 'center' : node.align === 'end' ? 'right' : 'left',
      }}
      onChange={(e) => setTextContent(id, e.target.value)}
      onKeyDown={(e) => {
        // Enter breaks the line; Escape and Ctrl/Cmd+Enter commit.
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
          e.preventDefault()
          e.target.blur()
        }
      }}
      onBlur={finish}
    />
  )
}
