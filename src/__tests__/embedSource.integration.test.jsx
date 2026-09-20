import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, fireEvent, cleanup, waitFor, screen } from '@testing-library/react'
import TopBar from '../panels/TopBar'
import ImportChoiceDialog from '../panels/ImportChoiceDialog'
import * as download from '../io/download'
import { extractProjectFromSvg, embedProjectInSvg, embedProjectInPng } from '../io/embedSource'
import { importFiles } from '../io/importFile'
import { serializeDocument } from '../io/serialize'
import { serializeProject } from '../io/project'
import { useStore } from '../state/store'
import { createDocument } from '../model/document'
import { createRect, addNode } from '../model/nodes'
import { tinyPng, StubImage } from './fixtures'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function sampleDoc() {
  const doc = createDocument()
  addNode(doc, createRect({ x: 1, y: 2, width: 30, height: 40 }))
  return doc
}

function loadSampleDoc() {
  const doc = sampleDoc()
  useStore.getState().loadDocument(doc)
  return doc
}

/** Open the File menu and click a menu entry by its label. */
function fileMenu() {
  fireEvent.click(screen.getByTitle('File'))
}

describe('the “Embed project source” export option', () => {
  it('is off by default: the SVG export is a plain drawing.svg', async () => {
    loadSampleDoc()
    const saved = vi.spyOn(download, 'downloadBlob').mockImplementation(() => {})
    render(<TopBar />)

    fileMenu()
    fireEvent.click(screen.getByText('Export as SVG'))

    await waitFor(() => expect(saved).toHaveBeenCalled())
    const [blob, filename] = saved.mock.calls[0]
    expect(filename).toBe('drawing.svg')
    expect(await blob.text()).not.toContain('lulogo:project')
  })

  it('writes drawing.lulogo.svg with the document inside it', async () => {
    const doc = loadSampleDoc()
    const saved = vi.spyOn(download, 'downloadBlob').mockImplementation(() => {})
    render(<TopBar />)

    fileMenu()
    fireEvent.click(screen.getByLabelText('Embed project source'))
    fireEvent.click(screen.getByText('Export as SVG'))

    await waitFor(() => expect(saved).toHaveBeenCalled())
    const [blob, filename] = saved.mock.calls[0]
    expect(filename).toBe('drawing.lulogo.svg')
    expect(extractProjectFromSvg(await blob.text())).toEqual(doc)
  })
})

describe('the dialog a file carrying a project raises', () => {
  const fileFor = (doc, name = 'logo.lulogo.svg') =>
    new File([embedProjectInSvg(serializeDocument(doc), doc)], name, { type: 'image/svg+xml' })

  it('names the file and opens the project when asked to', async () => {
    const dropped = sampleDoc()
    useStore.getState().loadDocument(createDocument())
    render(<ImportChoiceDialog />)

    const done = importFiles([fileFor(dropped)])

    await screen.findByText('This file carries a project')
    expect(screen.getByText('logo.lulogo.svg')).toBeTruthy()

    fireEvent.click(screen.getByText('Open as project'))
    await done

    expect(useStore.getState().document).toEqual(dropped)
    expect(screen.queryByText('This file carries a project')).toBe(null)
  })

  it('places the picture instead, leaving the current drawing in place', async () => {
    // A PNG, so the answer lands in the image path rather than paper.js — the
    // SVG parser needs a 2D canvas context jsdom cannot give it.
    vi.stubGlobal('Image', StubImage)
    const blank = createDocument()
    useStore.getState().loadDocument(blank)
    render(<ImportChoiceDialog />)

    const png = new File([embedProjectInPng(tinyPng(), sampleDoc())], 'logo.lulogo.png', { type: 'image/png' })
    const done = importFiles([png])

    await screen.findByText('This file carries a project')
    fireEvent.click(screen.getByText('Place as an image'))
    await done

    const doc = useStore.getState().document
    expect(doc.rootOrder).toHaveLength(blank.rootOrder.length + 1)
    expect(doc.nodes[doc.rootOrder[doc.rootOrder.length - 1]].type).toBe('image')
  })

  it('offers to add the project to the current drawing, keeping its settings', async () => {
    const current = createDocument()
    current.background = '#abcdef'
    addNode(current, createRect({ x: 0, y: 0, width: 5, height: 5 }))
    useStore.getState().loadDocument(current)
    render(<ImportChoiceDialog />)

    const done = importFiles([fileFor(sampleDoc())])

    await screen.findByText('This file carries a project')
    fireEvent.click(screen.getByText('Add to current project'))
    await done

    const doc = useStore.getState().document
    expect(doc.rootOrder).toHaveLength(2)
    expect(doc.rootOrder[0]).toBe(current.rootOrder[0])
    expect(doc.background).toBe('#abcdef')
    expect(useStore.getState().selection).toEqual([doc.rootOrder[1]])
  })

  it('offers only open and add for a .json save', async () => {
    useStore.getState().loadDocument(createDocument())
    render(<ImportChoiceDialog />)

    const json = new File([serializeProject(sampleDoc())], 'saved.lulogo.json', { type: 'application/json' })
    const done = importFiles([json])

    await screen.findByText('Open or add this project?')
    expect(screen.getByText('Open as project')).toBeTruthy()
    expect(screen.getByText('Add to current project')).toBeTruthy()
    expect(screen.queryByText('Place as an image')).toBe(null)
    expect(screen.queryByText('Import as shapes')).toBe(null)

    fireEvent.click(screen.getByText('Cancel'))
    await done
  })

  it('cancels on Escape and changes nothing', async () => {
    const blank = createDocument()
    useStore.getState().loadDocument(blank)
    render(<ImportChoiceDialog />)

    const done = importFiles([fileFor(sampleDoc())])

    await screen.findByText('This file carries a project')
    fireEvent.keyDown(window, { key: 'Escape' })
    await done

    expect(useStore.getState().document).toBe(blank)
  })
})
