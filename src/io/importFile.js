import { importSvgToNodes } from './importSvg'
import { fileToImageData } from './importImage'
import { isProjectFile, parseProject } from './project'
import { useStore } from '../state/store'
import { screenToWorld } from '../canvas/viewport'

function viewCenter() {
  const st = useStore.getState()
  const { width, height } = st.ui.canvasSize
  return screenToWorld((width || 0) / 2, (height || 0) / 2, st.viewport)
}

/**
 * Import a list of files: SVGs become nodes (grouped under the file name),
 * raster images become an image node centered at `atWorld` (or the view
 * center). Used by both the toolbar Import button and canvas file drops.
 */
export async function importFiles(files, atWorld) {
  for (const file of files) {
    if (isProjectFile(file)) {
      // An editable project file replaces the whole document.
      useStore.getState().loadDocument(parseProject(await file.text()))
      continue
    }
    const isSvg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)
    if (isSvg) {
      const text = await file.text()
      const { nodes, gradients } = await importSvgToNodes(text)
      useStore.getState().addImportedNodes(nodes, file.name.replace(/\.[^.]+$/, ''), gradients)
    } else if (file.type.startsWith('image/')) {
      const { href, width, height } = await fileToImageData(file)
      const c = atWorld || viewCenter()
      useStore.getState().addImageAt(href, width, height, c.x, c.y)
    }
  }
}
