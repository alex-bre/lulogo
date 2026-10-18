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
import ImportChoiceDialog from './panels/ImportChoiceDialog'
import DriveLaunchDialog from './panels/DriveLaunchDialog'
import { driveConfigured, parseDriveState } from './io/googleDrive'
import styles from './App.module.css'

/**
 * Drive's "Open with" lands here with `?state=…`. Take it off the URL straight
 * away — a reload or a bookmark should not ask to open the file a second time —
 * and leave the question to DriveLaunchDialog.
 */
function takeDriveLaunch() {
  const launch = parseDriveState(window.location.search)
  if (!launch) return
  const url = new URL(window.location.href)
  url.searchParams.delete('state')
  window.history.replaceState(null, '', url)
  if (driveConfigured) useStore.getState().setDriveLaunch(launch)
}

export default function App() {
  useThemeEffect()
  useResponsiveLayout()
  useShortcuts()
  useClipboard()
  useEffect(() => {
    initHistory()
    initPersist()
    takeDriveLaunch()
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
      {/* Files reach the app from the canvas and the clipboard as well as the
          toolbar, so the question one of them can raise is mounted app-wide. */}
      <ImportChoiceDialog />
      <DriveLaunchDialog />
    </div>
  )
}
