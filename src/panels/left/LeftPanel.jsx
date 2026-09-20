import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useStore } from '../../state/store'
import ShapeLibrary from './ShapeLibrary'
import PathTools from './PathTools'
import TextTool from './TextTool'
import styles from './LeftPanel.module.css'

/**
 * Left tool panel.
 *  - Shapes : shape library (Phase 2)
 *  - Path   : pen tool + boolean ops (Phase 5)
 *  - Text   : text tool (Phase 6)
 *
 * Collapses to a thin rail with an expand button.
 */
export default function LeftPanel() {
  const collapsed = useStore((s) => s.ui.leftCollapsed)
  const toggle = useStore((s) => s.toggleLeftPanel)

  if (collapsed) {
    return (
      <aside className={`${styles.rail} no-select`}>
        <button className={styles.railBtn} title="Expand tools panel" onClick={toggle}>
          <PanelLeftOpen size={16} />
        </button>
      </aside>
    )
  }

  return (
    <aside className={`${styles.panel} no-select`}>
      <div className={styles.header}>
        <button className={styles.collapseBtn} title="Collapse tools panel" onClick={toggle}>
          <PanelLeftClose size={16} />
        </button>
      </div>
      <Section title="Shapes">
        <ShapeLibrary />
      </Section>
      <Section title="Path">
        <PathTools />
      </Section>
      <Section title="Text">
        <TextTool />
      </Section>
    </aside>
  )
}

function Section({ title, children }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>{title}</h2>
      <div className={styles.body}>{children}</div>
    </section>
  )
}
