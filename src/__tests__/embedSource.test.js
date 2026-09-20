import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  embedProjectInSvg,
  extractProjectFromSvg,
  embedProjectInPng,
  extractProjectFromPng,
  hasEmbeddedSource,
  exportFilename,
  PNG_KEYWORD,
} from '../io/embedSource'
import { crc32, readChunks, readTextChunk, isPngBytes } from '../io/pngChunks'
import { buildExportSvg } from '../io/exportSvg'
import { forcedOffPlugins } from '../io/optimizeSvg'
import { importFiles, readProjectFile } from '../io/importFile'
import { answerImportChoice } from '../io/importChoice'
import { serializeDocument } from '../io/serialize'
import { serializeProject } from '../io/project'
import { useStore } from '../state/store'
import { createDocument } from '../model/document'
import { createRect, createText, createGroup, addNode } from '../model/nodes'
import { tinyPng, StubImage } from './fixtures'

function sampleDoc() {
  const doc = createDocument()
  const g = createGroup({ name: 'Layer 1' })
  addNode(doc, g)
  addNode(doc, createRect({ x: 1, y: 2, width: 3, height: 4, rx: 2 }), g.id)
  addNode(doc, createText({ x: 5, y: 6, text: 'héllo' }))
  return doc
}

describe('PNG chunks', () => {
  it('computes the CRC the file itself stores', () => {
    const png = tinyPng()
    const view = new DataView(png.buffer)
    let checked = 0
    for (const { at, data, type } of readChunks(png)) {
      const stored = view.getUint32(at + 8 + data.length)
      expect(crc32(png.subarray(at + 4, at + 8 + data.length))).toBe(stored)
      checked += 1
      if (type === 'IEND') break
    }
    expect(checked).toBeGreaterThan(2)
  })

  it('rejects bytes that are not a PNG', () => {
    expect(isPngBytes(Uint8Array.of(1, 2, 3))).toBe(false)
    expect([...readChunks(Uint8Array.of(1, 2, 3))]).toEqual([])
  })
})

describe('project source embedded in a PNG', () => {
  it('round-trips the document and leaves a valid PNG behind', () => {
    const doc = sampleDoc()
    const out = embedProjectInPng(tinyPng(), doc)

    expect(isPngBytes(out)).toBe(true)
    expect(extractProjectFromPng(out)).toEqual(doc)

    // The chunk sits between the header and the pixel data, where ancillary
    // chunks belong, and the walk still reaches the end of the file.
    const types = [...readChunks(out)].map((c) => c.type)
    expect(types[0]).toBe('IHDR')
    expect(types.indexOf('tEXt')).toBeLessThan(types.indexOf('IDAT'))
    expect(types[types.length - 1]).toBe('IEND')

    // …and it carries a CRC that matches what was written.
    const view = new DataView(out.buffer)
    for (const { at, data } of readChunks(out)) {
      expect(crc32(out.subarray(at + 4, at + 8 + data.length))).toBe(view.getUint32(at + 8 + data.length))
    }
    expect(readTextChunk(out, PNG_KEYWORD)).toMatch(/^[A-Za-z0-9+/=]+$/)
  })

  it('returns null for a PNG with no project in it', () => {
    expect(extractProjectFromPng(tinyPng())).toBe(null)
    expect(extractProjectFromPng(Uint8Array.of(1, 2, 3))).toBe(null)
  })

  it('throws rather than silently losing a damaged payload', () => {
    const out = embedProjectInPng(tinyPng(), sampleDoc())
    const text = readTextChunk(out, PNG_KEYWORD)
    // Corrupt the base64 in place — same length, so the chunk stays well-formed.
    const at = out.indexOf(text.charCodeAt(0), 8)
    const damaged = Uint8Array.from(out)
    damaged.set(Uint8Array.from('!!!!', (c) => c.charCodeAt(0)), at + 4)
    expect(() => extractProjectFromPng(damaged)).toThrow()
  })
})

describe('project source embedded in an SVG', () => {
  it('round-trips the document', () => {
    const doc = sampleDoc()
    const svg = embedProjectInSvg(serializeDocument(doc), doc)
    expect(extractProjectFromSvg(svg)).toEqual(doc)
  })

  it('keeps the markup a plain SVG: the payload sits inside <metadata>', () => {
    const doc = sampleDoc()
    const svg = embedProjectInSvg(serializeDocument(doc), doc)

    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true)
    expect(svg.indexOf('<metadata>')).toBeLessThan(svg.indexOf('<rect'))
    expect(new DOMParser().parseFromString(svg, 'image/svg+xml').querySelector('parsererror')).toBe(null)
  })

  it('reports no project for ordinary markup', () => {
    expect(extractProjectFromSvg(serializeDocument(sampleDoc()))).toBe(null)
    expect(extractProjectFromSvg('')).toBe(null)
    expect(hasEmbeddedSource('<svg/>')).toBe(false)
  })

  it('embeds the document as authored, not the exported flattening', async () => {
    // The export can be cropped, outlined or animated; the source that rides
    // along is the document itself, which is what makes reopening it useful.
    const doc = sampleDoc()
    const svg = await buildExportSvg(doc, { embedSource: true })
    expect(extractProjectFromSvg(svg)).toEqual(doc)
    expect(await buildExportSvg(doc, {})).not.toContain('lulogo:project')
  })

  it('holds the optimizer off <metadata> so minifying cannot strip the source', () => {
    const doc = sampleDoc()
    expect(forcedOffPlugins(serializeDocument(doc))).not.toContain('removeMetadata')
    expect(forcedOffPlugins(embedProjectInSvg(serializeDocument(doc), doc))).toContain('removeMetadata')
  })
})

describe('export filenames', () => {
  it('marks files that carry their source', () => {
    expect(exportFilename('drawing', 'svg', true)).toBe('drawing.lulogo.svg')
    expect(exportFilename('drawing', 'png', true)).toBe('drawing.lulogo.png')
    expect(exportFilename('animation', 'svg', true)).toBe('animation.lulogo.svg')
    expect(exportFilename('drawing', 'svg', false)).toBe('drawing.svg')
  })
})

const svgFile = (doc, name = 'logo.lulogo.svg') =>
  new File([embedProjectInSvg(serializeDocument(doc), doc)], name, { type: 'image/svg+xml' })
const pngFile = (doc, name = 'logo.lulogo.png') =>
  new File([embedProjectInPng(tinyPng(), doc)], name, { type: 'image/png' })

describe('opening files that carry a project', () => {
  it('reads the project out of an exported SVG or PNG', async () => {
    const doc = sampleDoc()
    expect(await readProjectFile(svgFile(doc))).toEqual(doc)
    expect(await readProjectFile(pngFile(doc))).toEqual(doc)
    expect(await readProjectFile(new File(['<svg/>'], 'plain.svg', { type: 'image/svg+xml' }))).toBe(null)
  })
})

describe('importing a file that carries a project asks what to do with it', () => {
  let stop = null

  beforeEach(() => {
    useStore.getState().loadDocument(createDocument())
    // The "place the picture" answer ends in the image decoder jsdom lacks.
    vi.stubGlobal('Image', StubImage)
  })
  afterEach(() => {
    stop?.()
    stop = null
    vi.unstubAllGlobals()
  })

  /** Stand in for the dialog: answer every question the import raises. */
  function answerWith(choice, seen = []) {
    stop = useStore.subscribe((s) => {
      if (!s.ui.importChoice) return
      seen.push(s.ui.importChoice)
      answerImportChoice(choice)
    })
    return seen
  }

  it('asks before replacing the document, naming the file', async () => {
    const doc = sampleDoc()
    const asked = answerWith('project')

    await importFiles([svgFile(doc)])

    expect(asked).toEqual([{ name: 'logo.lulogo.svg', kind: 'svg' }])
    expect(useStore.getState().document).toEqual(doc)
  })

  it('opens a PNG export as the project when that is the answer', async () => {
    const doc = sampleDoc()
    const asked = answerWith('project')

    await importFiles([pngFile(doc)])

    expect(asked).toEqual([{ name: 'logo.lulogo.png', kind: 'png' }])
    expect(useStore.getState().document).toEqual(doc)
  })

  it('places the picture instead when the answer is to keep it as artwork', async () => {
    const before = useStore.getState().document
    answerWith('artwork')

    await importFiles([pngFile(sampleDoc())])

    const after = useStore.getState().document
    expect(after).not.toEqual(before)
    // One image node landed on the canvas; the document was not replaced.
    const added = after.rootOrder.map((id) => after.nodes[id])
    expect(added).toHaveLength(before.rootOrder.length + 1)
    expect(added[added.length - 1].type).toBe('image')
  })

  it('leaves the document alone when the question is cancelled', async () => {
    const before = useStore.getState().document
    answerWith('cancel')

    await importFiles([svgFile(sampleDoc())])

    expect(useStore.getState().document).toBe(before)
  })

  it('asks once per file, in order', async () => {
    const asked = answerWith('cancel')

    await importFiles([svgFile(sampleDoc(), 'one.svg'), pngFile(sampleDoc(), 'two.png')])

    expect(asked.map((q) => q.name)).toEqual(['one.svg', 'two.png'])
  })

  it('recognizes the project even when the file has been renamed', async () => {
    const doc = sampleDoc()
    answerWith('project')

    await importFiles([pngFile(doc, 'holiday-photo.png')])

    expect(useStore.getState().document).toEqual(doc)
  })

  it('adds the project to the current drawing when that is the answer', async () => {
    const current = createDocument()
    current.page = { width: 640, height: 480 }
    addNode(current, createRect({ x: 0, y: 0, width: 5, height: 5 }))
    useStore.getState().loadDocument(current)
    answerWith('merge')

    await importFiles([pngFile(sampleDoc())])

    const doc = useStore.getState().document
    // The drop's layer and text sit on top of what was there; the page is ours.
    expect(doc.rootOrder).toHaveLength(3)
    expect(doc.rootOrder[0]).toBe(current.rootOrder[0])
    expect(doc.page).toEqual({ width: 640, height: 480 })
    expect(Object.values(doc.nodes).some((n) => n.type === 'text' && n.text === 'héllo')).toBe(true)
  })

  it('asks about a .json save too — without offering a picture it does not have', async () => {
    const asked = answerWith('merge')
    const json = new File([serializeProject(sampleDoc())], 'saved.lulogo.json', { type: 'application/json' })

    await importFiles([json])

    expect(asked).toEqual([{ name: 'saved.lulogo.json', kind: 'json' }])
    expect(useStore.getState().document.rootOrder).toHaveLength(2)
  })

  it('does not ask for a picture that carries no project', async () => {
    const asked = answerWith('project')

    await importFiles([new File([tinyPng()], 'photo.png', { type: 'image/png' })])

    expect(asked).toEqual([])
  })
})
