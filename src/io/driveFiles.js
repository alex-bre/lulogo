import { createDriveFile, downloadDriveFile, driveToken, pickFromDrive, updateDriveFile } from './googleDrive'
import { DRIVE_PROJECT_EXT, PROJECT_MIME, serializeProject } from './project'
import { importFiles, readProjectFile } from './importFile'
import { useStore } from '../state/store'

// Open, save and export through Google Drive — the app-level half of the Drive
// integration (`googleDrive.js` is the Google half).
//
// A project opened from or saved to Drive stays linked to that file
// (`ui.driveFile`), so "Save to Google Drive" writes back to it the way a
// desktop editor's Save does. Opening anything else unlinks it.

/** What the Drive picker offers to open: project saves, and pictures that may carry one. */
const OPENABLE = [PROJECT_MIME, 'application/json', 'image/svg+xml', 'image/png']

// The folder the user last worked in, so the next pick starts there. Kept for the
// session only.
let lastFolderId

const st = () => useStore.getState()

// Only an actual project save can be written back to. A .lulogo.svg opened as a
// project is still a picture, and overwriting it with JSON would destroy it.
const isProjectSave = ({ name, mimeType }) =>
  mimeType === PROJECT_MIME || mimeType === 'application/json' || /\.(lulogo|json)$/i.test(name)

async function openDriveFile(id) {
  const { meta, file } = await downloadDriveFile(id)
  if (meta.parents?.length) lastFolderId = meta.parents[0]
  const doc = await readProjectFile(file)
  if (!doc) {
    // A plain SVG or PNG: it comes in on the current drawing, as an import does.
    await importFiles([file])
    return
  }
  st().loadDocument(doc)
  if (isProjectSave(meta)) st().setDriveFile({ id: meta.id, name: meta.name, mimeType: meta.mimeType })
}

/** File menu → "Open from Google Drive…". */
export async function openFromDrive() {
  await driveToken()
  const picked = await pickFromDrive({ title: 'Open in Lulogo', mimeTypes: OPENABLE, parentId: lastFolderId })
  await openDriveFile(picked.id)
}

/**
 * Open the file Drive's "Open with → Lulogo" handed over (see
 * `parseDriveState`). Has to run from a click — the sign-in is a popup.
 */
export async function openDriveLaunch({ ids, userId }) {
  await driveToken({ loginHint: userId })
  await openDriveFile(ids[0])
}

/**
 * The name to create a file under, asked of the user with `suggested` filled in.
 * `ext` is appended when the answer does not already end in it. Null when they
 * cancel.
 */
function askFileName(suggested, ext) {
  const answer = window.prompt('File name in Google Drive', suggested)
  if (answer == null) return null
  const name = answer.trim() || suggested
  return name.toLowerCase().endsWith(ext) ? name : name + ext
}

async function uploadNew(blob, mimeType, suggestedName, ext) {
  const name = askFileName(suggestedName, ext)
  if (!name) return null
  const folder = await pickFromDrive({ title: `Save “${name}” in…`, folders: true, parentId: lastFolderId })
  lastFolderId = folder.id
  return createDriveFile({ name, mimeType, parentId: folder.id, blob })
}

/**
 * File menu → "Save to Google Drive". Writes back to the linked file when there
 * is one; otherwise — or with `asNew` — asks for a name and a folder and creates
 * a new `.lulogo` file there, which becomes the linked one.
 *
 * Resolves to the file's name, or null when the user backed out of naming it.
 */
export async function saveToDrive({ asNew = false } = {}) {
  await driveToken()
  const linked = st().ui.driveFile
  const text = serializeProject(st().document)

  if (linked && !asNew) {
    await updateDriveFile(linked.id, new Blob([text], { type: linked.mimeType }), linked.mimeType)
    return linked.name
  }

  const suggested = linked ? linked.name.replace(/(\.lulogo)?(\.json)?$/i, '') + ' copy' : 'drawing'
  const meta = await uploadNew(new Blob([text], { type: PROJECT_MIME }), PROJECT_MIME, suggested, DRIVE_PROJECT_EXT)
  if (!meta) return null
  st().setDriveFile({ id: meta.id, name: meta.name, mimeType: meta.mimeType })
  return meta.name
}

/**
 * A stand-in for `downloadBlob` that puts an export into Drive instead: the SVG
 * and PNG exporters take it as their `save`. Exports are never linked — each one
 * is a new file.
 */
export async function exportBlobToDrive(blob, filename) {
  const dot = filename.indexOf('.')
  const base = dot > 0 ? filename.slice(0, dot) : filename
  const ext = dot > 0 ? filename.slice(dot) : ''
  const mimeType = (blob.type || 'application/octet-stream').split(';')[0]
  const meta = await uploadNew(blob, mimeType, base, ext)
  return meta && meta.name
}
