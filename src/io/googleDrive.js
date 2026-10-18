// The Google side of the Drive integration: sign-in, the Drive REST calls and
// the Picker. Nothing here knows about documents — `driveFiles.js` builds the
// app's open/save/export on top of it.
//
// Lulogo has no server, so everything runs in the browser: Google Identity
// Services hands out a short-lived access token, the files go straight between
// this tab and the Drive API, and the token is held in memory only.
//
// The scope is `drive.file`, which reaches only the files a user opened with
// Lulogo, picked in the Picker, or created with it — never the rest of their
// Drive. `drive.install` is what makes Lulogo appear under Drive's "Open with".

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''
const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY || ''
const APP_ID = import.meta.env.VITE_GOOGLE_APP_ID || ''

/** Whether this build was given the Google identifiers it needs (see `.env.example`). */
export const driveConfigured = Boolean(CLIENT_ID && API_KEY && APP_ID)

const SCOPE_FILE = 'https://www.googleapis.com/auth/drive.file'
const SCOPE_INSTALL = 'https://www.googleapis.com/auth/drive.install'

const FILES_API = 'https://www.googleapis.com/drive/v3/files'
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files'
const META_FIELDS = 'id,name,mimeType,parents'
export const FOLDER_MIME = 'application/vnd.google-apps.folder'

/**
 * Thrown when the user backs out — closes the sign-in popup or the Picker.
 * Callers let it pass silently: stepping back is not an error to report.
 */
export class DriveCancelled extends Error {
  constructor() {
    super('Cancelled')
    this.cancelled = true
  }
}

/* ---------------- scripts ---------------- */

// Loaded on first use rather than in index.html: a visitor who never touches
// Drive never contacts Google at all.
const scripts = new Map()

function loadScript(src) {
  if (!scripts.has(src)) {
    scripts.set(
      src,
      new Promise((resolve, reject) => {
        const el = document.createElement('script')
        el.src = src
        el.async = true
        el.onload = resolve
        el.onerror = () => {
          scripts.delete(src)
          reject(new Error('Could not reach Google. Check your connection and try again.'))
        }
        document.head.appendChild(el)
      }),
    )
  }
  return scripts.get(src)
}

/* ---------------- sign-in ---------------- */

let token = null // { value, expiresAt }

/**
 * An access token for Drive, signing in if there is none or it is about to run
 * out.
 *
 * Call this first thing in a click handler: the sign-in is a popup, and
 * browsers only let a page open one in response to a user action.
 * `loginHint` (an email or Google user id) preselects the account — Drive passes
 * the one it opened the file for.
 */
export async function driveToken({ loginHint } = {}) {
  if (token && token.expiresAt - Date.now() > 60_000) return token.value
  await loadScript('https://accounts.google.com/gsi/client')
  const { oauth2 } = window.google.accounts
  return new Promise((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: `${SCOPE_FILE} ${SCOPE_INSTALL}`,
      login_hint: loginHint,
      callback: (res) => {
        if (res.error) return reject(new Error(res.error_description || `Google sign-in failed (${res.error})`))
        // The consent screen lets each scope be unticked. Without file access
        // nothing below can work, so say so instead of failing on the first call.
        if (!oauth2.hasGrantedAllScopes(res, SCOPE_FILE)) {
          return reject(new Error('Lulogo needs access to the files you open with it. Try again and allow it.'))
        }
        token = { value: res.access_token, expiresAt: Date.now() + Number(res.expires_in || 3600) * 1000 }
        resolve(token.value)
      },
      error_callback: (err) => {
        if (err?.type === 'popup_closed') reject(new DriveCancelled())
        else if (err?.type === 'popup_failed_to_open') reject(new Error('The Google sign-in window was blocked. Allow pop-ups for this site and try again.'))
        else reject(new Error(err?.message || 'Google sign-in failed'))
      },
    })
    client.requestAccessToken()
  })
}

/* ---------------- Drive REST ---------------- */

async function drive(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${await driveToken()}` },
  })
  if (res.ok) return res
  // A revoked or expired token: drop it, so the next attempt signs in afresh.
  if (res.status === 401) token = null
  let detail = `${res.status} ${res.statusText}`
  try {
    detail = (await res.json()).error.message || detail
  } catch {
    /* not a JSON error body — the status line will do */
  }
  throw new Error(`Google Drive: ${detail}`)
}

const query = (params) => new URLSearchParams({ supportsAllDrives: 'true', ...params }).toString()

/** A Drive file as a `File`, plus its metadata ({ id, name, mimeType, parents }). */
export async function downloadDriveFile(id) {
  const meta = await (await drive(`${FILES_API}/${encodeURIComponent(id)}?${query({ fields: META_FIELDS })}`)).json()
  const blob = await (await drive(`${FILES_API}/${encodeURIComponent(id)}?${query({ alt: 'media' })}`)).blob()
  return { meta, file: new File([blob], meta.name, { type: meta.mimeType }) }
}

/** Upload `blob` as a new file in the folder `parentId`; resolves to its metadata. */
export async function createDriveFile({ name, mimeType, parentId, blob }) {
  // One multipart/related request carries both the metadata and the content,
  // so there is never a moment where Drive holds an empty file by that name.
  const boundary = `lulogo-${Math.random().toString(36).slice(2)}`
  const metadata = { name, mimeType, ...(parentId ? { parents: [parentId] } : {}) }
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    JSON.stringify(metadata),
    `\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
    blob,
    `\r\n--${boundary}--`,
  ])
  const res = await drive(`${UPLOAD_API}?${query({ uploadType: 'multipart', fields: META_FIELDS })}`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  })
  return res.json()
}

/** Replace the content of an existing file, keeping its name, place and type. */
export async function updateDriveFile(id, blob, mimeType) {
  const res = await drive(`${UPLOAD_API}/${encodeURIComponent(id)}?${query({ uploadType: 'media', fields: META_FIELDS })}`, {
    method: 'PATCH',
    headers: { 'Content-Type': mimeType },
    body: blob,
  })
  return res.json()
}

/* ---------------- Picker ---------------- */

let pickerReady = null

function loadPicker() {
  pickerReady ||= loadScript('https://apis.google.com/js/api.js').then(
    () =>
      new Promise((resolve, reject) => {
        window.gapi.load('picker', { callback: resolve, onerror: () => reject(new Error('Could not load the Google Drive file picker.')) })
      }),
  )
  pickerReady.catch(() => (pickerReady = null))
  return pickerReady
}

/**
 * Let the user pick one item in Drive. Picking is also what grants Lulogo access
 * to it under `drive.file`, which is why the Picker is used even where a plain
 * list call would do.
 *
 * `folders` switches to choosing a folder (to save into). `parentId` opens the
 * Picker in that folder. Resolves to `{ id, name, mimeType }`, or rejects with
 * `DriveCancelled`.
 */
export async function pickFromDrive({ title, mimeTypes = [], folders = false, parentId } = {}) {
  const oauthToken = await driveToken()
  await loadPicker()
  const { picker } = window.google
  return new Promise((resolve, reject) => {
    const view = new picker.DocsView(folders ? picker.ViewId.FOLDERS : picker.ViewId.DOCS).setIncludeFolders(true)
    if (folders) view.setSelectFolderEnabled(true).setMimeTypes(FOLDER_MIME)
    else if (mimeTypes.length) view.setMimeTypes(mimeTypes.join(','))
    if (parentId) view.setParent(parentId)

    const builder = new picker.PickerBuilder()
      .setAppId(APP_ID)
      .setDeveloperKey(API_KEY)
      .setOAuthToken(oauthToken)
      .enableFeature(picker.Feature.SUPPORT_DRIVES)
      .addView(view)
      .setCallback((data) => {
        if (data.action === picker.Action.PICKED) {
          const { id, name, mimeType } = data.docs[0]
          resolve({ id, name, mimeType })
        } else if (data.action === picker.Action.CANCEL) {
          reject(new DriveCancelled())
        }
      })
    if (title) builder.setTitle(title)
    builder.build().setVisible(true)
  })
}

/* ---------------- "Open with" ---------------- */

// Drive file ids are URL-safe base64-ish; anything else in `state` is not one
// and must not end up in a request path.
const DRIVE_ID = /^[A-Za-z0-9_-]+$/

/**
 * The file Drive asked us to open, from the `?state=` it appends to the Open URL
 * (`{"ids":[…],"action":"open","userId":"…"}`), or null when the page was not
 * opened from Drive. Only `open` is handled — the "New" entry is not registered.
 */
export function parseDriveState(search) {
  const raw = new URLSearchParams(search).get('state')
  if (!raw) return null
  try {
    const state = JSON.parse(raw)
    if (state?.action !== 'open' || !Array.isArray(state.ids)) return null
    const ids = state.ids.filter((id) => typeof id === 'string' && DRIVE_ID.test(id))
    if (!ids.length) return null
    return { ids, userId: typeof state.userId === 'string' ? state.userId : undefined }
  } catch {
    return null
  }
}
