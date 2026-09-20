import { describe, it, expect } from 'vitest'
import { readImageClipboard, IC_CLIPBOARD_MARKER } from '../io/pasteImport'

// Build a minimal `paste`-event clipboardData stand-in.
function clip({ items, files, text = '' }) {
  return {
    items: items || undefined,
    files: files || undefined,
    getData: (type) => (type === 'text/plain' ? text : ''),
  }
}

const fileItem = (file) => ({ kind: 'file', getAsFile: () => file })

describe('readImageClipboard', () => {
  it('returns a pasted raster image file (via items)', () => {
    const png = new File(['x'], 'shot.png', { type: 'image/png' })
    const snap = readImageClipboard(clip({ items: [fileItem(png)] }))
    expect(snap.files).toHaveLength(1)
    expect(snap.files[0].type).toBe('image/png')
  })

  it('returns an SVG file (via items)', () => {
    const svg = new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' })
    const snap = readImageClipboard(clip({ items: [fileItem(svg)] }))
    expect(snap.files[0].type).toBe('image/svg+xml')
  })

  it('falls back to .files when items are absent', () => {
    const png = new File(['x'], 'shot.png', { type: 'image/png' })
    const snap = readImageClipboard(clip({ files: [png] }))
    expect(snap.files[0].name).toBe('shot.png')
  })

  it('wraps pasted SVG source text into an svg File', () => {
    const text = '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'
    const snap = readImageClipboard(clip({ text }))
    expect(snap.files).toHaveLength(1)
    expect(snap.files[0].type).toBe('image/svg+xml')
  })

  it('accepts SVG source that starts with the <svg> tag', () => {
    const snap = readImageClipboard(clip({ text: '  <svg viewBox="0 0 1 1"></svg>' }))
    expect(snap.files[0].type).toBe('image/svg+xml')
  })

  it('ignores plain text that is not an SVG', () => {
    expect(readImageClipboard(clip({ text: 'just some copied words' }))).toBeNull()
    expect(readImageClipboard(clip({ text: '<div>not svg</div>' }))).toBeNull()
  })

  it('ignores non-image files', () => {
    const txt = new File(['hi'], 'notes.txt', { type: 'text/plain' })
    expect(readImageClipboard(clip({ items: [fileItem(txt)] }))).toBeNull()
  })

  it('ignores our own internal-copy sentinel (falls back to internal paste)', () => {
    expect(readImageClipboard(clip({ text: IC_CLIPBOARD_MARKER }))).toBeNull()
  })

  it('returns null with no clipboard data', () => {
    expect(readImageClipboard(null)).toBeNull()
    expect(readImageClipboard(clip({}))).toBeNull()
  })
})
