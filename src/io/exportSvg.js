import { serializeDocument } from './serialize'
import { serializeAnimatedDocument } from './exportAnimatedSvg'
import { convertTextToPaths } from './textToPath'
import { embedProjectInSvg } from './embedSource'
import { downloadBlob } from './download'

export const SVG_MIME = 'image/svg+xml;charset=utf-8'

export function exportSvgString(doc) {
  return serializeDocument(doc)
}

/**
 * The exact markup an SVG export would write, without writing it.
 *
 * Shared by the download below and by the optimize dialog, which needs the same
 * bytes as its "before" so the saving it reports is the saving the user gets.
 */
export async function buildExportSvg(doc, { textToPaths = false, animated = false, loop = true, embedSource = false } = {}) {
  const d = textToPaths ? await convertTextToPaths(doc) : doc
  const svg = animated ? serializeAnimatedDocument(d, { loop }) : serializeDocument(d)
  // The *unflattened* doc goes in: the point of the embedded source is that it
  // reopens as it was authored, so outlined text must not be what comes back.
  return embedSource ? embedProjectInSvg(svg, doc) : svg
}

/** Trigger a download for already-serialized SVG markup. */
export function downloadSvgString(svg, filename = 'drawing.svg') {
  downloadBlob(new Blob([svg], { type: SVG_MIME }), filename)
}

/** Serialize and download as SVG. With `textToPaths`, text is outlined first. */
export async function downloadSvg(doc, { textToPaths = false, embedSource = false, filename = 'drawing.svg' } = {}) {
  downloadSvgString(await buildExportSvg(doc, { textToPaths, embedSource }), filename)
}
