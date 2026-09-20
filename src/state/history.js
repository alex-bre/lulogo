import { useStore } from './store'

// Undo/redo via document snapshots. We subscribe to document changes and push
// the *previous* document onto the past stack. Drags and text edits are wrapped
// in a "batch" so the whole gesture collapses into a single undo step.
//
// Note: useStore.setState (the external API) shallow-merges a returned partial
// and is NOT the immer-wrapped set used inside actions — so we return plain
// partials here.

const MAX = 100
let suspend = false
let batching = false
let batchRecorded = false

export function initHistory() {
  useStore.subscribe((state, prev) => {
    if (state.document === prev.document) return // non-document change
    if (suspend) return // applying an undo/redo
    if (batching) {
      if (!batchRecorded) {
        pushPast(prev.document)
        batchRecorded = true
      }
      return
    }
    pushPast(prev.document)
  })
}

function pushPast(doc) {
  useStore.setState((s) => {
    const past = s.past.length >= MAX ? [...s.past.slice(s.past.length - MAX + 1), doc] : [...s.past, doc]
    return { past, future: [] }
  })
}

/** Collapse all document changes until endHistoryBatch() into one undo step. */
export function beginHistoryBatch() {
  batching = true
  batchRecorded = false
}
export function endHistoryBatch() {
  batching = false
}

export function undo() {
  const st = useStore.getState()
  if (!st.past.length) return
  const previous = st.past[st.past.length - 1]
  suspend = true
  useStore.setState((s) => ({
    document: previous,
    past: s.past.slice(0, -1),
    future: [...s.future, s.document],
    selection: s.selection.filter((id) => previous.nodes[id]),
    ui: { ...s.ui, editingTextId: null, marquee: null },
  }))
  suspend = false
}

export function redo() {
  const st = useStore.getState()
  if (!st.future.length) return
  const next = st.future[st.future.length - 1]
  suspend = true
  useStore.setState((s) => ({
    document: next,
    future: s.future.slice(0, -1),
    past: [...s.past, s.document],
    selection: s.selection.filter((id) => next.nodes[id]),
    ui: { ...s.ui, editingTextId: null, marquee: null },
  }))
  suspend = false
}
