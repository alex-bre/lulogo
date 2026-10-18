import { downloadBlob } from './download'
import { DOCUMENT_VERSION, migrateDocument } from './migrate'

// An "editable project" file is the full document model wrapped with a format
// tag + version, saved as JSON. Unlike the SVG/PNG export (which flattens),
// this round-trips everything: groups, text-as-text, gradients, layer names.
//
// The same JSON is what an SVG or PNG export embeds when asked to carry its
// source — see `embedSource.js`. Opening any of them goes through
// `readProjectFile` in `importFile.js`.

const FORMAT = 'lulogo-editor'

// What Google Drive knows a project by. Drive picks the default app for a file
// by its MIME type, and Lulogo is registered as that app for this one and for
// the `.lulogo` extension — so files written to Drive carry both. The local
// download keeps `.lulogo.json`, which every OS can open as text.
export const PROJECT_MIME = 'application/vnd.lulogo+json'
export const DRIVE_PROJECT_EXT = '.lulogo'

export function serializeProject(doc) {
  return JSON.stringify({ format: FORMAT, version: DOCUMENT_VERSION, document: doc }, null, 2)
}

export function parseProject(text) {
  const data = JSON.parse(text)
  if (!data || data.format !== FORMAT || !data.document || !data.document.nodes) {
    throw new Error('Not a Lulogo project file')
  }
  // The version stamp used to be written and never read, which made it
  // decorative: a file from a future build was parsed as though it were
  // current. Every read now goes through the migration chain.
  return migrateDocument(data.document, data.version)
}

export function isProjectFile(file) {
  return (
    file.type === 'application/json' ||
    file.type === PROJECT_MIME ||
    /\.(json|lulogo)$/i.test(file.name)
  )
}

export function downloadProject(doc, filename = 'drawing.lulogo.json') {
  downloadBlob(new Blob([serializeProject(doc)], { type: 'application/json' }), filename)
}
