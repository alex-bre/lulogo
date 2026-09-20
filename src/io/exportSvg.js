import { serializeDocument } from './serialize'
import { serializeAnimatedDocument } from './exportAnimatedSvg'
import { convertTextToPaths } from './textToPath'
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
export async function buildExportSvg(doc, { textToPaths = false, animated = false, loop = true } = {}) {
  const d = textToPaths ? await convertTextToPaths(doc) : doc
  return animated ? serializeAnimatedDocument(d, { loop }) : serializeDocument(d)
}

/** Trigger a download for already-serialized SVG markup. */
export function downloadSvgString(svg, filename = 'drawing.svg') {
  downloadBlob(new Blob([svg], { type: SVG_MIME }), filename)
}

/** Serialize and download as SVG. With `textToPaths`, text is outlined first. */
export async function downloadSvg(doc, { textToPaths = false, filename = 'drawing.svg' } = {}) {
  downloadSvgString(await buildExportSvg(doc, { textToPaths }), filename)
}
