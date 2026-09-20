import { useMemo, useState } from 'react'
import { Code2, X, Copy, Check } from 'lucide-react'
import { useStore } from '../state/store'
import { serializeDocument } from '../io/serialize'
import styles from './SvgCodePanel.module.css'

/**
 * Collapsible drawer showing a live preview of the document's exported SVG code.
 * Collapsed by default; docked to the bottom-right of the canvas so it never
 * clashes with the zoom HUD (bottom-left). The SVG is only serialized while the
 * drawer is open, so a closed panel costs nothing on every document change.
 */
export default function SvgCodePanel() {
  const open = useStore((s) => s.ui.svgPreviewOpen)
  const toggle = useStore((s) => s.toggleSvgPreview)
  const doc = useStore((s) => s.document)
  const [copied, setCopied] = useState(false)

  const code = useMemo(() => (open ? serializeDocument(doc) : ''), [open, doc])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      /* clipboard unavailable */
    }
  }

  if (!open) {
    return (
      <button className={`${styles.fab} no-select`} title="Show SVG code" onClick={toggle}>
        <Code2 size={15} />
        SVG
      </button>
    )
  }

  return (
    <div className={`${styles.panel} no-select`}>
      <div className={styles.header}>
        <Code2 size={14} />
        <span className={styles.title}>SVG Code</span>
        <span className={styles.spacer} />
        <button className={styles.iconBtn} title="Copy to clipboard" onClick={copy}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
        <button className={styles.iconBtn} title="Close" onClick={toggle}>
          <X size={14} />
        </button>
      </div>
      <pre className={styles.code}>
        <code>{code}</code>
      </pre>
    </div>
  )
}
