import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useStore } from '../../state/store'
import ShapeLibrary from './ShapeLibrary'
import PathTools from './PathTools'
import TextTool from './TextTool'
import styles from './LeftPanel.module.css'

const TABS = [
  { id: 'shapes', label: 'Shapes' },
  { id: 'path', label: 'Path' },
  { id: 'text', label: 'Text' },
]

/**
 * Left tool panel, tabbed like the right panel.
 *  - Shapes : shape library (Phase 2)
 *  - Path   : pen tool + boolean ops (Phase 5)
 *  - Text   : text tool (Phase 6)
 *
 * Collapses to a thin rail with an expand button.
 */
export default function LeftPanel() {
  const leftTab = useStore((s) => s.ui.leftTab)
  const setLeftTab = useStore((s) => s.setLeftTab)
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
      <div className={styles.tabs} role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={leftTab === t.id}
            className={`${styles.tab} ${leftTab === t.id ? styles.tabActive : ''}`}
            onClick={() => setLeftTab(t.id)}
          >
            {t.label}
          </button>
        ))}
        <button className={styles.collapseBtn} title="Collapse tools panel" onClick={toggle}>
          <PanelLeftClose size={16} />
        </button>
      </div>

      <div className={styles.content}>
        {leftTab === 'shapes' && <ShapeLibrary />}
        {leftTab === 'path' && <PathTools />}
        {leftTab === 'text' && <TextTool />}
      </div>
    </aside>
  )
}
