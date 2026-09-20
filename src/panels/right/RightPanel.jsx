import { PanelRightClose, PanelRightOpen } from 'lucide-react'
import { useStore } from '../../state/store'
import GeneralTab from './tabs/GeneralTab'
import StyleTab from './tabs/StyleTab'
import ArrangeTab from './tabs/ArrangeTab'
import LayersTab from './tabs/LayersTab'
import styles from './RightPanel.module.css'

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'style', label: 'Style' },
  { id: 'arrange', label: 'Arrange' },
  { id: 'layers', label: 'Layers' },
]

/** Right properties panel. Collapses to a thin rail with an expand button. */
export default function RightPanel() {
  const rightTab = useStore((s) => s.ui.rightTab)
  const setRightTab = useStore((s) => s.setRightTab)
  const collapsed = useStore((s) => s.ui.rightCollapsed)
  const toggle = useStore((s) => s.toggleRightPanel)

  if (collapsed) {
    return (
      <aside className={`${styles.rail} no-select`}>
        <button className={styles.railBtn} title="Expand properties panel" onClick={toggle}>
          <PanelRightOpen size={16} />
        </button>
      </aside>
    )
  }

  return (
    <aside className={`${styles.panel} no-select`}>
      <div className={styles.tabs} role="tablist">
        <button className={styles.collapseBtn} title="Collapse properties panel" onClick={toggle}>
          <PanelRightClose size={16} />
        </button>
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={rightTab === t.id}
            className={`${styles.tab} ${rightTab === t.id ? styles.tabActive : ''}`}
            onClick={() => setRightTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className={styles.content}>
        {rightTab === 'general' && <GeneralTab />}
        {rightTab === 'style' && <StyleTab />}
        {rightTab === 'arrange' && <ArrangeTab />}
        {rightTab === 'layers' && <LayersTab />}
      </div>
    </aside>
  )
}
