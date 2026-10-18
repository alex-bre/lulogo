import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createDocument } from '../model/document'
import { createRect, addNode } from '../model/nodes'
import { isProjectFile, serializeProject, PROJECT_MIME } from '../io/project'
import { useStore } from '../state/store'

// The Google half is network and popups all the way down, so the app-level
// flows are tested against a stand-in for it. parseDriveState is pure and comes
// from the real module.
vi.mock('../io/googleDrive', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    driveToken: vi.fn(async () => 'token'),
    downloadDriveFile: vi.fn(),
    createDriveFile: vi.fn(),
    updateDriveFile: vi.fn(async () => ({})),
    pickFromDrive: vi.fn(),
  }
})

const drive = await import('../io/googleDrive')
const { openDriveLaunch, openFromDrive, saveToDrive, exportBlobToDrive } = await import('../io/driveFiles')

function projectDoc() {
  const doc = createDocument()
  addNode(doc, createRect({ x: 0, y: 0, width: 10, height: 10 }))
  return doc
}

const driveFile = (meta, content) => ({ meta, file: new File([content], meta.name, { type: meta.mimeType }) })

describe('parseDriveState', () => {
  const search = (state) => '?' + new URLSearchParams({ state: JSON.stringify(state) })

  it('reads the file Drive asked to open', () => {
    expect(drive.parseDriveState(search({ ids: ['abc_D-1'], action: 'open', userId: '42' }))).toEqual({
      ids: ['abc_D-1'],
      userId: '42',
    })
  })

  it('ignores pages not opened from Drive and actions other than open', () => {
    expect(drive.parseDriveState('')).toBe(null)
    expect(drive.parseDriveState('?state=not-json')).toBe(null)
    expect(drive.parseDriveState(search({ action: 'create', folderId: 'f' }))).toBe(null)
    expect(drive.parseDriveState(search({ action: 'open', ids: [] }))).toBe(null)
  })

  it('drops ids that could not be Drive ids, so none reaches a request path', () => {
    expect(drive.parseDriveState(search({ action: 'open', ids: ['../x', 'ok1'] }))).toEqual({ ids: ['ok1'], userId: undefined })
    expect(drive.parseDriveState(search({ action: 'open', ids: ['a/b', 7] }))).toBe(null)
  })
})

describe('project files', () => {
  it('recognises the .lulogo files Drive holds', () => {
    expect(isProjectFile(new File(['{}'], 'logo.lulogo'))).toBe(true)
    expect(isProjectFile(new File(['{}'], 'logo', { type: PROJECT_MIME }))).toBe(true)
    expect(isProjectFile(new File(['{}'], 'logo.lulogo.json'))).toBe(true)
    expect(isProjectFile(new File([''], 'logo.svg', { type: 'image/svg+xml' }))).toBe(false)
  })
})

describe('Drive open and save', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useStore.getState().loadDocument(createDocument())
  })

  it('opens the file from "Open with", signing in as the account Drive named, and links it', async () => {
    const doc = projectDoc()
    const meta = { id: 'f1', name: 'logo.lulogo', mimeType: PROJECT_MIME, parents: ['folder1'] }
    drive.downloadDriveFile.mockResolvedValue(driveFile(meta, serializeProject(doc)))

    await openDriveLaunch({ ids: ['f1'], userId: 'u1' })

    expect(drive.driveToken).toHaveBeenCalledWith({ loginHint: 'u1' })
    expect(drive.downloadDriveFile).toHaveBeenCalledWith('f1')
    expect(useStore.getState().document.rootOrder).toHaveLength(1)
    expect(useStore.getState().ui.driveFile).toEqual({ id: 'f1', name: 'logo.lulogo', mimeType: PROJECT_MIME })
  })

  it('saves a linked project back to the same file', async () => {
    useStore.getState().setDriveFile({ id: 'f1', name: 'logo.lulogo', mimeType: PROJECT_MIME })

    expect(await saveToDrive()).toBe('logo.lulogo')

    expect(drive.createDriveFile).not.toHaveBeenCalled()
    const [id, blob, mime] = drive.updateDriveFile.mock.calls[0]
    expect([id, mime]).toEqual(['f1', PROJECT_MIME])
    expect(JSON.parse(await blob.text()).format).toBe('lulogo-editor')
  })

  it('creates a new .lulogo file in the picked folder when nothing is linked', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('Badge')
    drive.pickFromDrive.mockResolvedValue({ id: 'folder9', name: 'Logos' })
    drive.createDriveFile.mockResolvedValue({ id: 'new1', name: 'Badge.lulogo', mimeType: PROJECT_MIME })

    expect(await saveToDrive()).toBe('Badge.lulogo')

    expect(drive.pickFromDrive).toHaveBeenCalledWith(expect.objectContaining({ folders: true }))
    expect(drive.createDriveFile).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Badge.lulogo', mimeType: PROJECT_MIME, parentId: 'folder9' }),
    )
    expect(useStore.getState().ui.driveFile).toEqual({ id: 'new1', name: 'Badge.lulogo', mimeType: PROJECT_MIME })
  })

  it('does nothing when the file name prompt is cancelled', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue(null)
    expect(await saveToDrive()).toBe(null)
    expect(drive.pickFromDrive).not.toHaveBeenCalled()
    expect(drive.createDriveFile).not.toHaveBeenCalled()
  })

  it('opens a picked SVG with an embedded project without linking it, so a save never overwrites the picture', async () => {
    const { embedProjectInSvg } = await import('../io/embedSource')
    const svg = embedProjectInSvg('<svg xmlns="http://www.w3.org/2000/svg"></svg>', projectDoc())
    drive.pickFromDrive.mockResolvedValue({ id: 's1', name: 'logo.lulogo.svg', mimeType: 'image/svg+xml' })
    drive.downloadDriveFile.mockResolvedValue(
      driveFile({ id: 's1', name: 'logo.lulogo.svg', mimeType: 'image/svg+xml', parents: [] }, svg),
    )

    await openFromDrive()

    expect(useStore.getState().document.rootOrder).toHaveLength(1)
    expect(useStore.getState().ui.driveFile).toBe(null)
  })

  it('opening a project from anywhere else unlinks the Drive file', () => {
    useStore.getState().setDriveFile({ id: 'f1', name: 'logo.lulogo', mimeType: PROJECT_MIME })
    useStore.getState().loadDocument(createDocument())
    expect(useStore.getState().ui.driveFile).toBe(null)
  })

  it('exports keep their extension and type in Drive', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('Badge')
    drive.pickFromDrive.mockResolvedValue({ id: 'folder9', name: 'Logos' })
    drive.createDriveFile.mockResolvedValue({ id: 'e1', name: 'Badge.lulogo.svg' })

    const blob = new Blob(['<svg/>'], { type: 'image/svg+xml;charset=utf-8' })
    expect(await exportBlobToDrive(blob, 'drawing.lulogo.svg')).toBe('Badge.lulogo.svg')

    expect(window.prompt).toHaveBeenCalledWith(expect.any(String), 'drawing')
    expect(drive.createDriveFile).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Badge.lulogo.svg', mimeType: 'image/svg+xml', parentId: 'folder9' }),
    )
    expect(useStore.getState().ui.driveFile).toBe(null)
  })
})
