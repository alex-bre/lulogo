import { useEffect } from 'react'
import { useStore } from '../state/store'
import { undo, redo } from '../state/history'
import { isEditable } from './inputState'

const NUDGE = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }

/** Global keyboard shortcuts (ignored while typing in inputs). */
export function useShortcuts() {
  useEffect(() => {
    const onKey = (e) => {
      if (isEditable(e.target)) return
      const st = useStore.getState()
      const sel = st.selection
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()

      // ---- editing / clipboard / history (Ctrl/Cmd) ----
      if (mod) {
        if (key === 'z' && !e.shiftKey) return e.preventDefault(), undo()
        if ((key === 'z' && e.shiftKey) || key === 'y') return e.preventDefault(), redo()
        // Copy/cut/paste (Ctrl/Cmd+C/X/V) are handled via the native
        // copy/cut/paste events (see useClipboard) so the OS clipboard stays the
        // single source of truth — the newest copy wins, be it a shape or an
        // external image.
        if (key === 'd') return e.preventDefault(), sel.length && st.duplicateNodes(sel)
        if (key === 'a') return e.preventDefault(), st.selectAll()
        if (key === 'g' && e.shiftKey) return e.preventDefault(), sel.length && st.ungroupSelection()
        if (key === 'g') return e.preventDefault(), sel.length && st.groupSelection()
        return
      }

      // ---- no modifier ----
      const { editingPathId, activeAnchor } = st.ui
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (editingPathId && activeAnchor) {
          e.preventDefault()
          st.deletePathPoint(editingPathId, activeAnchor.sp, activeAnchor.ai)
        } else if (sel.length) {
          e.preventDefault()
          st.removeNodes(sel)
        }
      } else if (NUDGE[e.key] && sel.length) {
        e.preventDefault()
        const [dx, dy] = NUDGE[e.key]
        const d = e.shiftKey ? 10 : 1
        st.translateNodes(sel, dx * d, dy * d)
      } else if (key === 'v') {
        st.setTool('select')
      } else if (key === 'p') {
        st.setTool('pen')
      } else if (key === 't') {
        st.setTool('text')
      } else if (e.key === 'Enter' && st.ui.t3d) {
        e.preventDefault()
        st.applyT3D()
      } else if (e.key === 'Escape') {
        if (st.ui.t3d) st.cancelT3D()
        else if (editingPathId) st.setEditingPath(null)
        else st.clearSelection()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
