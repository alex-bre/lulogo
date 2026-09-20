import { importFiles } from './importFile'

// Sentinel written to the system clipboard whenever shapes are copied/cut
// internally (see useClipboard). Its purpose is to *claim* the OS clipboard so
// an internal copy overwrites any external image — this is what makes "the
// newest copy always wins". On paste we recognise it and route to the internal
// object clipboard instead of trying to import it as content.
export const IC_CLIPBOARD_MARKER = 'application/x-lulogo-clipboard'

// Heuristic for "this pasted text is an SVG document" (as opposed to arbitrary
// text). We only treat text as importable when it clearly starts like an SVG.
function looksLikeSvg(text) {
  if (!text) return false
  const t = text.trim()
  return /^(?:<\?xml|<!DOCTYPE\s+svg|<svg[\s>])/i.test(t) && /<svg[\s>]/i.test(t)
}

// Gather File objects off a paste/drop DataTransfer. `items[i].getAsFile()` must
// be called synchronously while the event is live, so this stays sync.
function filesFromClipboard(clipboardData) {
  const files = []
  const items = clipboardData.items
  if (items && items.length) {
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      if (it.kind === 'file') {
        const f = it.getAsFile()
        if (f) files.push(f)
      }
    }
  }
  // Fall back to .files for sources that don't populate .items.
  if (!files.length && clipboardData.files && clipboardData.files.length) {
    for (const f of clipboardData.files) files.push(f)
  }
  return files
}

const isImageOrSvg = (f) => f.type.startsWith('image/') || /\.svg$/i.test(f.name || '')

/**
 * Synchronously read the importable image/SVG content out of a `paste` event's
 * clipboardData (which is only valid during the event). Returns `{ files }`
 * ready to hand to importFiles(), or `null` when there's nothing to import.
 */
export function readImageClipboard(clipboardData) {
  if (!clipboardData) return null
  const text = clipboardData.getData ? clipboardData.getData('text/plain') : ''
  // Our own internal-copy sentinel: not external content — let the caller fall
  // back to the internal object clipboard.
  if (text && text.startsWith(IC_CLIPBOARD_MARKER)) return null
  const files = filesFromClipboard(clipboardData).filter(isImageOrSvg)
  if (files.length) return { files }
  // SVG source pasted as plain text (e.g. copied from an editor).
  if (looksLikeSvg(text)) {
    return { files: [new File([text], 'pasted.svg', { type: 'image/svg+xml' })] }
  }
  return null
}

/**
 * Read images/SVG from the system clipboard via the async Clipboard API. Used
 * where no native `paste` event is available (e.g. the canvas context menu).
 * Imports whatever it finds and resolves `true`, or `false` if nothing usable
 * (unavailable API, denied permission, or no image/SVG on the clipboard).
 */
export async function importClipboardImagesAsync(atWorld) {
  const clip = typeof navigator !== 'undefined' ? navigator.clipboard : null
  if (!clip || !clip.read) return false
  let items
  try {
    items = await clip.read()
  } catch {
    return false
  }
  const files = []
  for (const item of items) {
    const svgType = item.types.find((t) => t === 'image/svg+xml')
    const imgType = item.types.find((t) => t.startsWith('image/') && t !== 'image/svg+xml')
    if (svgType) {
      const blob = await item.getType(svgType)
      files.push(new File([await blob.text()], 'pasted.svg', { type: 'image/svg+xml' }))
    } else if (imgType) {
      const blob = await item.getType(imgType)
      const ext = imgType.split('/')[1] || 'png'
      files.push(new File([blob], `pasted.${ext}`, { type: imgType }))
    } else if (item.types.includes('text/plain')) {
      const text = await (await item.getType('text/plain')).text()
      if (looksLikeSvg(text)) files.push(new File([text], 'pasted.svg', { type: 'image/svg+xml' }))
    }
  }
  if (!files.length) return false
  await importFiles(files, atWorld)
  return true
}
