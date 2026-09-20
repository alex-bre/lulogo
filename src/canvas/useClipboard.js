import { useEffect } from 'react'
import { useStore } from '../state/store'
import { importFiles } from '../io/importFile'
import { readImageClipboard, IC_CLIPBOARD_MARKER } from '../io/pasteImport'
import { isEditable } from './inputState'

// Claim the OS clipboard for an internal copy/cut. Writing our sentinel wipes
// whatever was there (e.g. an external image) so this — the newest copy — is
// what a later paste sees. Wrapped in try/catch since clipboardData isn't
// writable in every context.
function claimClipboard(e) {
  try {
    e.clipboardData.setData('text/plain', IC_CLIPBOARD_MARKER)
  } catch {
    /* ignore — worst case an external image survives */
  }
}

/**
 * Global clipboard handling via the native copy/cut/paste events (so the OS
 * clipboard is the single source of truth and the newest copy always wins,
 * whether it's an internal shape or an external image):
 *
 *  - copy/cut  → snapshot the selection to the internal clipboard AND claim the
 *                OS clipboard, overwriting any external image.
 *  - paste     → an external image/SVG is imported onto the canvas; otherwise
 *                (including our own sentinel) fall back to the internal clipboard.
 *
 * Events targeting text inputs are left alone so normal editing still works.
 */
export function useClipboard() {
  useEffect(() => {
    const onCopy = (e) => {
      if (isEditable(e.target)) return
      const st = useStore.getState()
      if (!st.selection.length) return
      st.copySelection()
      claimClipboard(e)
      e.preventDefault()
    }
    const onCut = (e) => {
      if (isEditable(e.target)) return
      const st = useStore.getState()
      if (!st.selection.length) return
      st.cutSelection()
      claimClipboard(e)
      e.preventDefault()
    }
    const onPaste = (e) => {
      if (isEditable(e.target)) return
      const snapshot = readImageClipboard(e.clipboardData)
      e.preventDefault()
      if (snapshot) {
        // atWorld omitted → importFiles centres each image in the current view.
        importFiles(snapshot.files).catch((err) => console.error('Paste import failed', err))
      } else {
        useStore.getState().pasteClipboard()
      }
    }
    window.addEventListener('copy', onCopy)
    window.addEventListener('cut', onCut)
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('copy', onCopy)
      window.removeEventListener('cut', onCut)
      window.removeEventListener('paste', onPaste)
    }
  }, [])
}
