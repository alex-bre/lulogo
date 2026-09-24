import { importSvgToNodes } from './importSvg'
import { fileToImageData } from './importImage'
import { isProjectFile, parseProject } from './project'
import { extractProjectFromSvg, extractProjectFromPng } from './embedSource'
import { askImportChoice } from './importChoice'
import { drawioDocumentFromText, drawioDocumentFromPng } from './importDrawio'
import { useStore } from '../state/store'
import { screenToWorld } from '../canvas/viewport'

function viewCenter() {
  const st = useStore.getState()
  const { width, height } = st.ui.canvasSize
  return screenToWorld((width || 0) / 2, (height || 0) / 2, st.viewport)
}

const isSvgFile = (file) => file.type === 'image/svg+xml' || /\.svg$/i.test(file.name || '')
const isPngFile = (file) => file.type === 'image/png' || /\.png$/i.test(file.name || '')
// draw.io's own save, and the HTML page it exports (.drawio.svg/.png are SVG/PNG).
const isDrawioFile = (file) => /\.(drawio|xml|html?)$/i.test(file.name || '')

async function readDrawioFile(file) {
  const doc = await drawioDocumentFromText(await file.text())
  if (!doc) throw new Error(`“${file.name}” holds no draw.io diagram.`)
  return doc
}

// A Lulogo project first, else a draw.io diagram: either one is a document.
const projectInSvg = async (text) => extractProjectFromSvg(text) || drawioDocumentFromText(text)
const projectInPng = async (bytes) => extractProjectFromPng(bytes) || drawioDocumentFromPng(bytes)

const loadDocument = (doc) => useStore.getState().loadDocument(doc)

/**
 * The project a file carries, or null when it is only artwork.
 *
 * Three things count as a project: the .json save, and the SVG or PNG exports
 * that were written with their source embedded (see `embedSource.js`). Opening
 * those is what makes an exported picture round-trip. A draw.io diagram — its
 * .drawio save, or an SVG/PNG/HTML carrying one — opens as one too
 * (see `importDrawio.js`).
 */
export async function readProjectFile(file) {
  if (isProjectFile(file)) return parseProject(await file.text())
  if (isDrawioFile(file)) return readDrawioFile(file)
  if (isSvgFile(file)) return projectInSvg(await file.text())
  if (isPngFile(file)) return projectInPng(new Uint8Array(await file.arrayBuffer()))
  return null
}

/** Open a project file and replace the current document. */
export async function openProjectFile(file) {
  const doc = await readProjectFile(file)
  if (!doc) {
    throw new Error(
      `“${file.name}” holds no project data. Open a .lulogo.json save, an SVG/PNG ` +
        `exported with “Embed project source”, or a draw.io diagram.`,
    )
  }
  loadDocument(doc)
}

/**
 * A file carrying a project can come in more than one way, so ask: open it in
 * place of the current document, add its artwork on top of the current one, or
 * — for an SVG/PNG — bring in only the picture.
 *
 * Returns true when that settled the file (opened, added, or cancelled). False
 * means carry on and import it as the picture it also is.
 */
async function handledAsProject(project, file, kind) {
  if (!project) return false
  const choice = await askImportChoice(file.name, kind)
  if (choice === 'project') loadDocument(project)
  else if (choice === 'merge') useStore.getState().mergeDocument(project)
  return choice !== 'artwork'
}

/**
 * Import a list of files: SVGs become nodes (grouped under the file name),
 * raster images become an image node centered at `atWorld` (or the view
 * center). Used by both the toolbar Import button and canvas file drops.
 *
 * Anything carrying a project — a .json save, or an SVG/PNG with its source
 * embedded — asks whether to open it or add it to the current drawing (see
 * `handledAsProject`). Whichever is chosen is a single undo step.
 */
export async function importFiles(files, atWorld) {
  for (const file of files) {
    if (isProjectFile(file)) {
      await handledAsProject(parseProject(await file.text()), file, 'json')
      continue
    }
    if (isDrawioFile(file)) {
      await handledAsProject(await readDrawioFile(file), file, 'drawio')
      continue
    }
    if (isSvgFile(file)) {
      const text = await file.text()
      if (await handledAsProject(await projectInSvg(text), file, 'svg')) continue
      const { nodes, gradients } = await importSvgToNodes(text)
      useStore.getState().addImportedNodes(nodes, file.name.replace(/\.[^.]+$/, ''), gradients)
    } else if (file.type.startsWith('image/') || isPngFile(file)) {
      if (isPngFile(file)) {
        const project = await projectInPng(new Uint8Array(await file.arrayBuffer()))
        if (await handledAsProject(project, file, 'png')) continue
      }
      const { href, width, height } = await fileToImageData(file)
      const c = atWorld || viewCenter()
      useStore.getState().addImageAt(href, width, height, c.x, c.y)
    }
  }
}
