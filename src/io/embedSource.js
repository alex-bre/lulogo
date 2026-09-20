import { serializeProject, parseProject } from './project'
import { insertChunk, isPngBytes, encodeTextChunk, readTextChunk, latin1 } from './pngChunks'

// Exported pictures that are still editable projects — the trick draw.io plays
// with its diagrams. The exported SVG or PNG is an ordinary image to every
// viewer, and carries the project JSON in a place the format reserves for
// metadata, so dropping the file back on this canvas reopens the real document:
// groups, text as text, gradients, layer names, animation.
//
// Both formats carry the same string — the project JSON, base64 so it survives
// XML escaping on one side and PNG's Latin-1 text on the other. SVG puts it in
// <metadata>, PNG in a tEXt chunk.

/** The tEXt keyword a PNG stores the project under. */
export const PNG_KEYWORD = 'lulogo-project'

/** Namespace for the <metadata> child, so the element can't collide with anything. */
export const SVG_NS = 'https://lulogo.app/ns/project'

// Marks a file as carrying its own source: `drawing.lulogo.svg`, matching the
// `.lulogo.json` the project save already writes.
const SOURCE_SUFFIX = '.lulogo'

/** `drawing`,`svg` → `drawing.lulogo.svg` when the source rides along. */
export function exportFilename(base, ext, embedSource) {
  return `${base}${embedSource ? SOURCE_SUFFIX : ''}.${ext}`
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function toBase64(text) {
  return btoa(latin1(encoder.encode(text)))
}

function fromBase64(b64) {
  const bin = atob(b64.replace(/\s+/g, ''))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return decoder.decode(bytes)
}

/* ---------------- SVG ---------------- */

// Tolerant on purpose: the optimizer may re-order or re-quote the attributes on
// the way through, so the payload is found by element name, not by exact markup.
const SVG_PROJECT_RE = /<lulogo:project\b[^>]*>([\s\S]*?)<\/lulogo:project>/

/** Whether this markup already carries an embedded project. */
export function hasEmbeddedSource(svg) {
  return SVG_PROJECT_RE.test(svg || '')
}

/** Return `svg` with the project JSON added as a <metadata> child of the root. */
export function embedProjectInSvg(svg, doc) {
  const payload = toBase64(serializeProject(doc))
  const metadata =
    `  <metadata>\n` +
    `    <lulogo:project xmlns:lulogo="${SVG_NS}" encoding="base64">${payload}</lulogo:project>\n` +
    `  </metadata>\n`

  const open = /<svg\b[^>]*>\n?/.exec(svg)
  // Only ever called on our own serializer's output, so a miss means the markup
  // changed shape — louder than silently handing back a file with no source in it.
  if (!open) throw new Error('Could not embed the project source: no <svg> element')
  const at = open.index + open[0].length
  return svg.slice(0, at) + (svg[at - 1] === '\n' ? '' : '\n') + metadata + svg.slice(at)
}

/**
 * The document embedded in SVG markup, or null when there is none.
 *
 * A payload that is present but unreadable throws: the file announced itself as
 * a project, and importing it as flat artwork instead would quietly lose the
 * editability the user exported it for.
 */
export function extractProjectFromSvg(svg) {
  const m = SVG_PROJECT_RE.exec(svg || '')
  if (!m) return null
  return readPayload(m[1].trim())
}

/* ---------------- PNG ---------------- */

/** Return a copy of the PNG bytes with the project JSON added as a tEXt chunk. */
export function embedProjectInPng(bytes, doc) {
  return insertChunk(bytes, 'tEXt', encodeTextChunk(PNG_KEYWORD, toBase64(serializeProject(doc))))
}

/** The document embedded in PNG bytes, or null when there is none. */
export function extractProjectFromPng(bytes) {
  if (!isPngBytes(bytes)) return null
  const text = readTextChunk(bytes, PNG_KEYWORD)
  return text == null ? null : readPayload(text)
}

function readPayload(payload) {
  let json
  try {
    json = fromBase64(payload)
  } catch {
    throw new Error('This file carries project data, but it is damaged and could not be read.')
  }
  return parseProject(json)
}
