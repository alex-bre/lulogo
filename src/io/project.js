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
  return file.type === 'application/json' || /\.json$/i.test(file.name)
}

export function downloadProject(doc, filename = 'drawing.lulogo.json') {
  downloadBlob(new Blob([serializeProject(doc)], { type: 'application/json' }), filename)
}
