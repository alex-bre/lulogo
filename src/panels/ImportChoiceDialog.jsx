import { useEffect, useRef } from 'react'
import { FileInput, FolderOpen, Image as ImageIcon, Shapes } from 'lucide-react'
import { useStore } from '../state/store'
import { answerImportChoice } from '../io/importChoice'
import styles from './ImportChoiceDialog.module.css'

/**
 * Asked when a dropped, pasted or imported file turns out to carry a project
 * (io/importChoice.js). Mounted for the whole session and renders nothing until
 * there is a question, because the files it answers for arrive at the canvas as
 * often as at the toolbar.
 */
export default function ImportChoiceDialog() {
  const request = useStore((s) => s.ui.importChoice)
  const cardRef = useRef(null)
  const firstRef = useRef(null)

  useEffect(() => {
    if (!request) return
    firstRef.current?.focus()
    // Capture phase and stopPropagation, as in the other dialogs: useShortcuts
    // also listens for Escape, where it clears the selection.
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      answerImportChoice('cancel')
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [request])

  if (!request) return null

  const { name, kind } = request
  const choices = [
    {
      choice: 'project',
      icon: FolderOpen,
      label: 'Open as project',
      note: 'Replaces what is on the canvas now — undo brings it back',
    },
    {
      choice: 'merge',
      icon: FileInput,
      label: 'Add to current project',
      note: 'Puts its layers and groups on top, where they were drawn. Page size, background and other settings stay as they are',
    },
  ]
  // A .json save has no picture in it, so "just the picture" only exists for exports.
  if (kind === 'png') {
    choices.push({
      choice: 'artwork',
      icon: ImageIcon,
      label: 'Place as an image',
      note: 'Adds the flat picture to the current drawing, source and all',
    })
  } else if (kind === 'svg') {
    choices.push({
      choice: 'artwork',
      icon: Shapes,
      label: 'Import as shapes',
      note: 'Adds the exported artwork as plain shapes — no layer names, text as exported',
    })
  }

  return (
    <div
      className={styles.backdrop}
      onPointerDown={(e) => {
        if (!cardRef.current?.contains(e.target)) answerImportChoice('cancel')
      }}
    >
      <div className={styles.card} ref={cardRef} role="dialog" aria-modal="true" aria-labelledby="import-choice-title">
        <h2 className={styles.title} id="import-choice-title">
          {kind === 'json' ? 'Open or add this project?' : 'This file carries a project'}
        </h2>
        <p className={styles.blurb}>
          <span className={styles.filename}>{name}</span>
          {kind === 'json'
            ? ' is a saved project. Open it on its own, or add it to what you are working on?'
            : ' was exported with its editable source inside it. How should it come in?'}
        </p>

        <div className={styles.choices}>
          {choices.map(({ choice, icon: Icon, label, note }, i) => (
            <button
              key={choice}
              className={styles.choice}
              ref={i === 0 ? firstRef : undefined}
              onClick={() => answerImportChoice(choice)}
            >
              <Icon className={styles.choiceIcon} size={17} aria-hidden />
              <span className={styles.choiceText}>
                <span className={styles.choiceLabel}>{label}</span>
                <span className={styles.choiceNote}>{note}</span>
              </span>
            </button>
          ))}
        </div>

        <div className={styles.footer}>
          <button className={styles.cancel} onClick={() => answerImportChoice('cancel')}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
