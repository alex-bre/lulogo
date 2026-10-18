import { useEffect, useRef, useState } from 'react'
import { CloudDownload } from 'lucide-react'
import { useStore } from '../state/store'
import { openDriveLaunch } from '../io/driveFiles'
// Same card as the import question: both ask one thing about a file on its way in.
import styles from './ImportChoiceDialog.module.css'

/**
 * Shown when Google Drive's "Open with → Lulogo" started the app.
 *
 * Drive hands over only the file's id, and reading it takes a Google sign-in,
 * which is a popup — and a popup needs a click to be allowed. So the app does
 * not try on load; it asks, and the button is that click.
 */
export default function DriveLaunchDialog() {
  const launch = useStore((s) => s.ui.driveLaunch)
  const setDriveLaunch = useStore((s) => s.setDriveLaunch)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const cardRef = useRef(null)
  const openRef = useRef(null)

  const close = () => {
    if (!loading) setDriveLaunch(null)
  }

  useEffect(() => {
    if (!launch) return
    openRef.current?.focus()
    // Capture phase and stopPropagation, as in the other dialogs: useShortcuts
    // also listens for Escape, where it clears the selection.
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      close()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  if (!launch) return null

  const open = async () => {
    setLoading(true)
    setError(null)
    try {
      await openDriveLaunch(launch)
      setDriveLaunch(null)
    } catch (err) {
      if (!err?.cancelled) {
        console.error(err)
        setError(err?.message || 'Something went wrong')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className={styles.backdrop}
      onPointerDown={(e) => {
        if (!cardRef.current?.contains(e.target)) close()
      }}
    >
      <div className={styles.card} ref={cardRef} role="dialog" aria-modal="true" aria-labelledby="drive-launch-title">
        <h2 className={styles.title} id="drive-launch-title">
          Open from Google Drive
        </h2>
        <p className={styles.blurb}>
          Google Drive asked Lulogo to open a file. Sign in with Google to load it. A project
          replaces what is on the canvas now — undo brings it back.
        </p>
        {error && (
          <p className={styles.blurb} role="alert">
            <span className={styles.filename}>{error}</span>
          </p>
        )}

        <div className={styles.choices}>
          <button className={styles.choice} ref={openRef} disabled={loading} onClick={open}>
            <CloudDownload className={styles.choiceIcon} size={17} aria-hidden />
            <span className={styles.choiceText}>
              <span className={styles.choiceLabel}>{loading ? 'Opening…' : 'Sign in and open'}</span>
              <span className={styles.choiceNote}>
                Lulogo only gets access to the files you open with it or save with it
              </span>
            </span>
          </button>
        </div>

        <div className={styles.footer}>
          <button className={styles.cancel} disabled={loading} onClick={close}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
