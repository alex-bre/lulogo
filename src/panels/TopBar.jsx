import { useEffect, useRef, useState } from 'react'
import { Upload, Download, Sun, Moon, ChevronDown, Undo2, Redo2, FolderOpen, Save, Info, Minimize2 } from 'lucide-react'
import { BUILD_LABEL } from '../buildInfo'
import AboutDialog from './AboutDialog'
import OptimizeDialog from './OptimizeDialog'
import { useStore } from '../state/store'
import { undo, redo } from '../state/history'
import { buildExportSvg, downloadSvg } from '../io/exportSvg'
import { downloadAnimatedSvg } from '../io/exportAnimatedSvg'
import { downloadPng } from '../io/exportPng'
import { downloadProject, openProjectFile } from '../io/project'
import { importFiles } from '../io/importFile'
import { cropDocumentToSelection } from '../io/cropDocument'
import styles from './TopBar.module.css'

export default function TopBar() {
  const theme = useStore((s) => s.ui.theme)
  const followsSystem = useStore((s) => s.ui.themePref === 'system')
  const toggleTheme = useStore((s) => s.toggleTheme)
  const canUndo = useStore((s) => s.past.length > 0)
  const canRedo = useStore((s) => s.future.length > 0)
  const hasAnimation = useStore((s) => !!(s.document.animation && s.document.animation.clips.length))
  const hasSelection = useStore((s) => s.selection.length > 0)

  const importRef = useRef(null)
  const projectRef = useRef(null)
  const menuRef = useRef(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [textToPaths, setTextToPaths] = useState(false)
  const [selectionOnly, setSelectionOnly] = useState(false)
  const [busy, setBusy] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  // Set to { svg, filename, animated } while the optimize dialog is open.
  const [optimizing, setOptimizing] = useState(null)

  useEffect(() => {
    if (!menuOpen) return
    const onDoc = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onDoc)
    return () => document.removeEventListener('pointerdown', onDoc)
  }, [menuOpen])

  const withBusy = async (fn) => {
    setBusy(true)
    try {
      await fn()
    } catch (err) {
      console.error(err)
      alert(err?.message || 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const onImportPick = async (e) => {
    const files = e.target.files
    if (files && files.length) await withBusy(() => importFiles(files))
    e.target.value = ''
  }
  const onProjectPick = async (e) => {
    const file = e.target.files && e.target.files[0]
    if (file) await withBusy(() => openProjectFile(file))
    e.target.value = ''
  }
  // SVG/PNG exports honor "Export selection only": crop + fit to the current
  // selection when it's checked and something is selected.
  const exportDoc = () => {
    const st = useStore.getState()
    return selectionOnly && st.selection.length ? cropDocumentToSelection(st.document, st.selection) : st.document
  }
  const runExport = (fn) => {
    setMenuOpen(false)
    withBusy(() => fn(exportDoc()))
  }

  // The optimizer works on markup, not on the document, so the export is
  // serialized here exactly as the plain SVG export would write it — same
  // selection crop, same text handling, animation included when there is any.
  // That way the "before" size the dialog reports is a real file size.
  const openOptimize = () => {
    setMenuOpen(false)
    withBusy(async () => {
      const svg = await buildExportSvg(exportDoc(), {
        textToPaths,
        animated: hasAnimation,
        loop: useStore.getState().ui.anim.loop,
      })
      setOptimizing({ svg, animated: hasAnimation, filename: hasAnimation ? 'animation.svg' : 'drawing.svg' })
    })
  }
  // The editable project file always saves the full document (never cropped).
  const saveProject = () => {
    setMenuOpen(false)
    withBusy(() => downloadProject(useStore.getState().document))
  }

  return (
    <header className={`${styles.topbar} no-select`}>
      {/* The build label rides on the brand as a tooltip: no layout cost, and it
          survives the wordmark being dropped on narrow viewports. */}
      <div className={styles.brand} title={BUILD_LABEL}>
        {/* The full lockup carries the wordmark, so there is no text label
            beside it. Under 900px it swaps for the bare mark — the same trade
            the wordmark-hiding rule used to make, now done in the artwork. */}
        <img
          className={styles.logoFull}
          src={`${import.meta.env.BASE_URL}lulogo-logo.svg`}
          width="91.25"
          height="27.5"
          alt="Lulogo"
        />
        <img
          className={styles.logoMark}
          src={`${import.meta.env.BASE_URL}lulogo-favicon.svg`}
          width="27.5"
          height="27.5"
          alt="Lulogo"
        />
      </div>

      <div className={styles.group}>
        <button className={styles.iconBtn} title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo}>
          <Undo2 size={16} />
        </button>
        <button className={styles.iconBtn} title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redo}>
          <Redo2 size={16} />
        </button>
      </div>

      <div className={styles.group}>
        <button className={styles.btn} title="Import SVG or image onto the canvas" onClick={() => importRef.current.click()}>
          <Upload size={15} />
          <span className={styles.btnLabel}>Import</span>
        </button>
        <input ref={importRef} type="file" accept=".svg,image/*" multiple hidden onChange={onImportPick} />
        <input ref={projectRef} type="file" accept=".json,application/json" hidden onChange={onProjectPick} />

        <div className={styles.menuWrap} ref={menuRef}>
          <button className={styles.btn} title="File" onClick={() => setMenuOpen((o) => !o)}>
            <Download size={15} />
            <span className={styles.btnLabel}>File</span>
            <ChevronDown size={13} />
          </button>
          {menuOpen && (
            <div className={styles.menu}>
              <button
                className={styles.menuItem}
                onClick={() => {
                  setMenuOpen(false)
                  projectRef.current.click()
                }}
              >
                <FolderOpen size={15} />
                Open project…
              </button>
              <button className={styles.menuItem} onClick={saveProject}>
                <Save size={15} />
                Save project
              </button>

              <div className={styles.menuSep} />

              <label
                className={styles.menuCheck}
                title={
                  hasSelection
                    ? 'Export only the selected objects, cropped to fit their bounds'
                    : 'Select objects on the canvas to enable'
                }
              >
                <input
                  type="checkbox"
                  checked={selectionOnly && hasSelection}
                  disabled={!hasSelection}
                  onChange={(e) => setSelectionOnly(e.target.checked)}
                />
                Export selection only
              </label>
              <label className={styles.menuCheck}>
                <input type="checkbox" checked={textToPaths} onChange={(e) => setTextToPaths(e.target.checked)} />
                Convert text to paths
              </label>
              <button className={styles.menuItem} onClick={() => runExport((d) => downloadSvg(d, { textToPaths }))}>
                Export as SVG
              </button>
              <button
                className={styles.menuItem}
                disabled={!hasAnimation}
                title={hasAnimation ? 'SVG with the timeline baked in as CSS keyframes' : 'Add effects in the Animation panel first'}
                onClick={() => runExport((d) => downloadAnimatedSvg(d, { loop: useStore.getState().ui.anim.loop }))}
              >
                Export as SVG (animated)
              </button>
              <button
                className={styles.menuItem}
                title="Minify the SVG and check the result before saving"
                onClick={openOptimize}
              >
                <Minimize2 size={15} />
                Optimize SVG…
              </button>
              <button className={styles.menuItem} onClick={() => runExport((d) => downloadPng(d))}>
                Export as PNG
              </button>
            </div>
          )}
        </div>
      </div>

      <div className={styles.spacer} />

      {busy && <span className={styles.busy}>Working…</span>}

      {/* The one entry point for everything legal: the source link AGPL §13 owes
          anyone running this over a network, the licence and notice files, the
          privacy policy and the Impressum. It has to live in the app, because
          the app *is* the whole site — a visitor has nowhere else to look. */}
      <button className={styles.iconBtn} onClick={() => setAboutOpen(true)} title="About, licences & privacy">
        <Info size={16} />
      </button>

      <button
        className={styles.iconBtn}
        onClick={toggleTheme}
        title={
          `Switch to ${theme === 'light' ? 'dark' : 'light'} mode` +
          (followsSystem ? ' (currently following the system setting)' : '')
        }
      >
        {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
      </button>

      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
      {optimizing && (
        <OptimizeDialog
          source={optimizing.svg}
          filename={optimizing.filename}
          animated={optimizing.animated}
          onClose={() => setOptimizing(null)}
        />
      )}
    </header>
  )
}
