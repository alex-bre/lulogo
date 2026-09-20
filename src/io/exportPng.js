import { serializeDocument } from './serialize'
import { downloadBlob } from './download'

/**
 * Rasterize the document to PNG by drawing the serialized SVG (as a data URL,
 * which keeps the canvas un-tainted) onto a canvas at `scale`× the page size.
 * Text renders via the browser's own fonts.
 */
export async function downloadPng(doc, { scale = 1, filename = 'drawing.png' } = {}) {
  const svg = serializeDocument(doc)
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)

  const img = new Image()
  await new Promise((resolve, reject) => {
    img.onload = resolve
    img.onerror = () => reject(new Error('Failed to render SVG for PNG export'))
    img.src = url
  })

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(doc.page.width * scale))
  canvas.height = Math.max(1, Math.round(doc.page.height * scale))
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)

  await new Promise((resolve) =>
    canvas.toBlob((b) => {
      if (b) downloadBlob(b, filename)
      resolve()
    }, 'image/png'),
  )
}
