import { useStore, STORAGE_KEY, THEME_KEY } from './store'
import { DOCUMENT_VERSION } from '../io/migrate'

// Autosave the document to localStorage (debounced) whenever it changes. The
// initial load happens in the store itself (loadInitialDocument).
//
// Stored as a `{ version, document }` envelope so a future build can tell which
// schema wrote it. Autosaves predating the envelope are the bare document, and
// readAutosave still accepts that shape.
export function initPersist() {
  let timer
  useStore.subscribe((state, prev) => {
    if (state.document === prev.document) return
    clearTimeout(timer)
    timer = setTimeout(() => {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ version: DOCUMENT_VERSION, document: useStore.getState().document }),
        )
      } catch {
        /* storage full or unavailable — ignore */
      }
    }, 500)
  })

  initThemePersist()
}

// Remember an explicit light/dark choice across sessions. 'system' is the
// *absence* of a choice, so it clears the key rather than storing it — that is
// what puts the editor back under the OS setting on the next load.
export function initThemePersist() {
  useStore.subscribe((state, prev) => {
    if (state.ui.themePref === prev.ui.themePref) return
    try {
      if (state.ui.themePref === 'system') localStorage.removeItem(THEME_KEY)
      else localStorage.setItem(THEME_KEY, state.ui.themePref)
    } catch {
      /* storage unavailable — the choice just won't outlive the session */
    }
  })
}
