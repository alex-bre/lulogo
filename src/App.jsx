import { useEffect } from 'react'
import { useThemeEffect } from './state/useTheme'
import { useResponsiveLayout } from './state/useResponsiveLayout'
import { useShortcuts } from './canvas/useShortcuts'
import { useClipboard } from './canvas/useClipboard'
import { initHistory } from './state/history'
import { initPersist } from './state/persist'
import { useStore } from './state/store'
import TopBar from './panels/TopBar'
import LeftPanel from './panels/left/LeftPanel'
import RightPanel from './panels/right/RightPanel'
import CanvasView from './canvas/CanvasView'
import AnimationPanel from './panels/bottom/AnimationPanel'
import styles from './App.module.css'

export default function App() {
  useThemeEffect()
  useResponsiveLayout()
  useShortcuts()
  useClipboard()
  useEffect(() => {
    initHistory()
    initPersist()
  }, [])

  const leftCollapsed = useStore((s) => s.ui.leftCollapsed)
  const rightCollapsed = useStore((s) => s.ui.rightCollapsed)

  const cls = [styles.app, leftCollapsed && styles.leftCollapsed, rightCollapsed && styles.rightCollapsed]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={cls}>
      <TopBar />
      <LeftPanel />
      <CanvasView />
      <RightPanel />
      <AnimationPanel />
    </div>
  )
}
