import { describe, it, expect, beforeAll } from 'vitest'
import { useStore } from '../state/store'
import { initHistory, undo, redo, beginHistoryBatch, endHistoryBatch } from '../state/history'
import { createDocument } from '../model/document'
import { createRect } from '../model/nodes'

beforeAll(() => initHistory())

// Reset to a clean doc with empty history. The first setState records the old
// document (a document change), so a second clears the stacks.
function reset() {
  useStore.setState({ document: createDocument(), selection: [], past: [], future: [] })
  useStore.setState({ past: [], future: [] })
}

describe('undo / redo', () => {
  it('undoes and redoes a node addition', () => {
    reset()
    const n = createRect({ x: 0, y: 0, width: 10, height: 10 })
    useStore.getState().addImportedNodes([n])
    expect(useStore.getState().document.nodes[n.id]).toBeTruthy()
    expect(useStore.getState().past).toHaveLength(1)

    undo()
    expect(useStore.getState().document.nodes[n.id]).toBeUndefined()
    expect(useStore.getState().future).toHaveLength(1)

    redo()
    expect(useStore.getState().document.nodes[n.id]).toBeTruthy()
    expect(useStore.getState().future).toHaveLength(0)
  })

  it('collapses a batch into one undo step', () => {
    reset()
    const n = createRect({ x: 0, y: 0, width: 10, height: 10 })
    useStore.getState().addImportedNodes([n])
    const before = useStore.getState().past.length

    beginHistoryBatch()
    useStore.getState().translateNodes([n.id], 5, 0)
    useStore.getState().translateNodes([n.id], 5, 0)
    useStore.getState().translateNodes([n.id], 5, 0)
    endHistoryBatch()

    expect(useStore.getState().document.nodes[n.id].x).toBe(15)
    expect(useStore.getState().past.length).toBe(before + 1)

    undo()
    expect(useStore.getState().document.nodes[n.id].x).toBe(0)
  })
})

describe('clipboard', () => {
  it('copies and pastes the selection as new nodes', () => {
    reset()
    const n = createRect({ x: 0, y: 0, width: 10, height: 10 })
    useStore.getState().addImportedNodes([n])
    useStore.setState({ selection: [n.id] })

    useStore.getState().copySelection()
    useStore.getState().pasteClipboard()

    const st = useStore.getState()
    expect(st.document.rootOrder).toHaveLength(2)
    expect(st.selection).toHaveLength(1)
    expect(st.selection[0]).not.toBe(n.id)
  })

  it('cut removes the selection but keeps it pasteable', () => {
    reset()
    const n = createRect({ x: 0, y: 0, width: 10, height: 10 })
    useStore.getState().addImportedNodes([n])
    useStore.setState({ selection: [n.id] })

    useStore.getState().cutSelection()
    expect(useStore.getState().document.nodes[n.id]).toBeUndefined()

    useStore.getState().pasteClipboard()
    expect(useStore.getState().document.rootOrder).toHaveLength(1)
  })
})

describe('copy / paste style', () => {
  it('copies a solid style from one node onto another', () => {
    reset()
    const a = createRect({ x: 0, y: 0, width: 10, height: 10, style: { fill: '#ff0000', strokeWidth: 3 } })
    const b = createRect({ x: 20, y: 0, width: 10, height: 10, style: { fill: '#00ff00' } })
    useStore.getState().addImportedNodes([a])
    useStore.getState().addImportedNodes([b])

    useStore.setState({ selection: [a.id] })
    useStore.getState().copyStyle()
    expect(useStore.getState().ui.hasStyleClip).toBe(true)

    useStore.setState({ selection: [b.id] })
    useStore.getState().pasteStyle([b.id])

    const st = useStore.getState()
    expect(st.document.nodes[b.id].style.fill).toBe('#ff0000')
    expect(st.document.nodes[b.id].style.strokeWidth).toBe(3)
    // Source is untouched.
    expect(st.document.nodes[a.id].style.fill).toBe('#ff0000')
  })

  it('recreates a gradient fill under a fresh id when pasting style', () => {
    reset()
    const a = createRect({ x: 0, y: 0, width: 10, height: 10 })
    const b = createRect({ x: 20, y: 0, width: 10, height: 10 })
    useStore.getState().addImportedNodes([a])
    useStore.getState().addImportedNodes([b])
    useStore.getState().upsertGradient({
      id: 'grad_a',
      type: 'linear',
      angle: 45,
      stops: [
        { offset: 0, color: '#ff0000', opacity: 1 },
        { offset: 1, color: '#0000ff', opacity: 1 },
      ],
    })
    useStore.getState().updateStyle([a.id], { fill: 'url(#grad_a)' })

    useStore.setState({ selection: [a.id] })
    useStore.getState().copyStyle()
    useStore.setState({ selection: [b.id] })
    useStore.getState().pasteStyle([b.id])

    const st = useStore.getState()
    const aGid = fillGradId(st.document.nodes[a.id])
    const bGid = fillGradId(st.document.nodes[b.id])
    expect(bGid).toBeTruthy()
    // Fresh id so the two objects don't share (and mutate) one gradient.
    expect(bGid).not.toBe(aGid)
    expect(st.document.defs.gradients[bGid].angle).toBe(45)
  })
})

// Helper: id of the gradient a node's fill references, if any.
const fillGradId = (node) => {
  const m = node?.style?.fill?.match(/^url\(#(.+)\)$/)
  return m ? m[1] : null
}

describe('gradient independence', () => {
  function withGradient() {
    reset()
    const n = createRect({ x: 0, y: 0, width: 10, height: 10 })
    useStore.getState().addImportedNodes([n])
    useStore.getState().upsertGradient({
      id: 'grad_src',
      type: 'linear',
      angle: 90,
      stops: [
        { offset: 0, color: '#ff0000', opacity: 1 },
        { offset: 1, color: '#0000ff', opacity: 1 },
      ],
    })
    useStore.getState().updateStyle([n.id], { fill: 'url(#grad_src)' })
    return n
  }

  it('duplicating gives the copy its own gradient', () => {
    const n = withGradient()
    useStore.getState().duplicateNodes([n.id])

    const st = useStore.getState()
    const copyId = st.selection[0]
    const srcGid = fillGradId(st.document.nodes[n.id])
    const copyGid = fillGradId(st.document.nodes[copyId])
    expect(copyGid).toBeTruthy()
    expect(copyGid).not.toBe(srcGid)

    // Editing the copy's gradient must not touch the original's.
    const copyGrad = st.document.defs.gradients[copyGid]
    useStore.getState().upsertGradient({ ...copyGrad, stops: [{ offset: 0, color: '#00ff00', opacity: 1 }] })
    expect(useStore.getState().document.defs.gradients[srcGid].stops).toHaveLength(2)
    expect(useStore.getState().document.defs.gradients[srcGid].stops[0].color).toBe('#ff0000')
  })

  it('pasting gives the copy its own gradient', () => {
    const n = withGradient()
    useStore.setState({ selection: [n.id] })
    useStore.getState().copySelection()
    useStore.getState().pasteClipboard()

    const st = useStore.getState()
    const copyId = st.selection[0]
    const srcGid = fillGradId(st.document.nodes[n.id])
    const copyGid = fillGradId(st.document.nodes[copyId])
    expect(copyGid).toBeTruthy()
    expect(copyGid).not.toBe(srcGid)
  })
})
