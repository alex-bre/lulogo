import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronRight, Copy, Download, Minimize2, RotateCcw, TriangleAlert, X } from 'lucide-react'
import {
  DEFAULT_SETTINGS,
  OPTIMIZE_PLUGINS,
  byteLength,
  forcedOffPlugins,
  FORCED_OFF_REASONS,
  formatBytes,
  gzipLength,
  loadSettings,
  optimizeSvg,
  saveSettings,
} from '../io/optimizeSvg'
import { SVG_MIME, downloadSvgString } from '../io/exportSvg'
import styles from './OptimizeDialog.module.css'

/** A Blob URL for `text`, revoked when it changes or the dialog closes. */
function useSvgUrl(text) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    if (!text) {
      setUrl(null)
      return
    }
    const next = URL.createObjectURL(new Blob([text], { type: SVG_MIME }))
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [text])
  return url
}

/** Raw and gzipped byte counts for `text` (gzip resolves a tick later). */
function useSizes(text) {
  const raw = useMemo(() => (text ? byteLength(text) : 0), [text])
  const [gzip, setGzip] = useState(null)
  useEffect(() => {
    let live = true
    setGzip(null)
    if (text) gzipLength(text).then((n) => live && setGzip(n))
    return () => {
      live = false
    }
  }, [text])
  return { raw, gzip }
}

function Slider({ label, value, onChange, hint }) {
  return (
    <label className={styles.slider}>
      <span className={styles.sliderTop}>
        <span>{label}</span>
        <span className={styles.sliderValue}>{value}</span>
      </span>
      <input type="range" min="0" max="8" step="1" value={value} onChange={(e) => onChange(+e.target.value)} />
      {hint && <span className={styles.hint}>{hint}</span>}
    </label>
  )
}

/**
 * SVGOMG-style export dialog: minify the markup an SVG export would write, and
 * show the result next to the original so it can be checked before saving.
 *
 * The preview is deliberately an <img> of the actual file rather than the
 * markup inlined into this page — inlined SVG inherits the editor's CSS and
 * would show something the downloaded file does not, which is precisely the
 * mistake this dialog exists to catch.
 */
export default function OptimizeDialog({ source, filename = 'drawing.svg', animated = false, onClose }) {
  const cardRef = useRef(null)
  const closeRef = useRef(null)
  const [settings, setSettings] = useState(loadSettings)
  const [optimized, setOptimized] = useState(null)
  const [error, setError] = useState(null)
  const [running, setRunning] = useState(true)
  const [view, setView] = useState('image') // image | code
  const [showOriginal, setShowOriginal] = useState(false)
  const [copied, setCopied] = useState(false)

  const forcedOff = useMemo(() => forcedOffPlugins(source), [source])

  // Re-run on every settings change, debounced so dragging a slider does not
  // queue one full optimize pass per pixel.
  useEffect(() => {
    let live = true
    setRunning(true)
    const timer = setTimeout(() => {
      optimizeSvg(source, settings)
        .then(({ data }) => {
          if (!live) return
          setOptimized(data)
          setError(null)
        })
        .catch((err) => {
          if (!live) return
          setError(err?.message || 'Could not optimize this SVG')
          setOptimized(null)
        })
        .finally(() => live && setRunning(false))
    }, 140)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [source, settings])

  useEffect(() => saveSettings(settings), [settings])

  useEffect(() => {
    closeRef.current?.focus()
    // Capture phase and stopPropagation, as in AboutDialog: useShortcuts also
    // listens for Escape and would clear the selection behind the dialog.
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const before = useSizes(source)
  const after = useSizes(optimized)
  const shown = showOriginal || !optimized ? source : optimized
  const url = useSvgUrl(shown)

  const saved = optimized && before.raw ? 1 - after.raw / before.raw : 0
  const savedGzip = after.gzip != null && before.gzip ? 1 - after.gzip / before.gzip : null

  const set = (patch) => setSettings((s) => ({ ...s, ...patch }))
  const setPlugin = (id, on) => setSettings((s) => ({ ...s, plugins: { ...s.plugins, [id]: on } }))
  const enabledCount = OPTIMIZE_PLUGINS.filter((p) => settings.plugins[p.id] && !forcedOff.includes(p.id)).length

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(optimized || source)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div
      className={styles.backdrop}
      onPointerDown={(e) => {
        if (!cardRef.current?.contains(e.target)) onClose()
      }}
    >
      <div className={styles.card} ref={cardRef} role="dialog" aria-modal="true" aria-labelledby="optimize-title">
        <div className={styles.header}>
          <Minimize2 size={16} className={styles.headerIcon} aria-hidden />
          <div className={styles.heading}>
            <h2 className={styles.title} id="optimize-title">
              Optimize SVG
            </h2>
            <p className={styles.subtitle}>
              {animated ? 'Animated export' : 'Static export'} · {filename}
            </p>
          </div>
          <button className={styles.iconBtn} ref={closeRef} onClick={onClose} title="Close (Esc)">
            <X size={16} />
          </button>
        </div>

        <div className={styles.body}>
          <div className={styles.previewPane}>
            <div className={styles.previewBar}>
              <div className={styles.segmented} role="group" aria-label="Preview source">
                <button
                  className={!showOriginal ? styles.segOn : styles.seg}
                  onClick={() => setShowOriginal(false)}
                >
                  Optimized
                </button>
                <button className={showOriginal ? styles.segOn : styles.seg} onClick={() => setShowOriginal(true)}>
                  Original
                </button>
              </div>
              <span className={styles.spacer} />
              {running && <span className={styles.working}>Optimizing…</span>}
              <div className={styles.segmented} role="group" aria-label="Preview mode">
                <button className={view === 'image' ? styles.segOn : styles.seg} onClick={() => setView('image')}>
                  Image
                </button>
                <button className={view === 'code' ? styles.segOn : styles.seg} onClick={() => setView('code')}>
                  Code
                </button>
              </div>
            </div>

            {error && (
              <p className={styles.error}>
                <TriangleAlert size={14} aria-hidden /> {error} — showing the original.
              </p>
            )}

            {view === 'image' ? (
              <div className={styles.stage}>
                {url && <img className={styles.preview} src={url} alt="" />}
              </div>
            ) : (
              <pre className={styles.code}>
                <code>{shown}</code>
              </pre>
            )}
          </div>

          <div className={styles.sidebar}>
            <div className={styles.stats}>
              <div className={styles.statRow}>
                <span>Original</span>
                <span className={styles.statValue}>{formatBytes(before.raw)}</span>
              </div>
              <div className={styles.statRow}>
                <span>Optimized</span>
                <span className={styles.statValue}>{optimized ? formatBytes(after.raw) : '—'}</span>
              </div>
              <div className={styles.bar}>
                <span
                  className={styles.barFill}
                  style={{ width: `${Math.max(0, Math.min(1, 1 - saved)) * 100}%` }}
                />
              </div>
              <div className={styles.savedRow}>
                <strong className={saved > 0 ? styles.savedGood : styles.savedFlat}>
                  {optimized ? `${saved >= 0 ? '−' : '+'}${Math.abs(saved * 100).toFixed(1)}%` : '—'}
                </strong>
                <span className={styles.gzip}>
                  {after.gzip != null
                    ? `gzip ${formatBytes(after.gzip)}${savedGzip != null ? ` (−${(savedGzip * 100).toFixed(1)}%)` : ''}`
                    : ''}
                </span>
              </div>
            </div>

            <div className={styles.controls}>
              <Slider
                label="Number precision"
                value={settings.precision}
                onChange={(precision) => set({ precision })}
                hint="Digits kept on coordinates. Lower is smaller and less exact."
              />
              <Slider
                label="Transform precision"
                value={settings.transformPrecision}
                onChange={(transformPrecision) => set({ transformPrecision })}
              />
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={settings.multipass}
                  onChange={(e) => set({ multipass: e.target.checked })}
                />
                Multipass
                <span className={styles.hint}>Repeat until nothing shrinks</span>
              </label>
              <label className={styles.check}>
                <input type="checkbox" checked={settings.pretty} onChange={(e) => set({ pretty: e.target.checked })} />
                Pretty markup
                <span className={styles.hint}>Readable, but larger</span>
              </label>
            </div>

            <details className={styles.plugins}>
              <summary className={styles.pluginSummary}>
                <ChevronRight className={styles.chevron} size={13} aria-hidden />
                Plugins
                <span className={styles.count}>
                  {enabledCount}/{OPTIMIZE_PLUGINS.length}
                </span>
              </summary>
              {forcedOff.map((id) => (
                <p key={id} className={styles.pluginNote}>
                  {FORCED_OFF_REASONS[id]}
                </p>
              ))}
              <ul className={styles.pluginList}>
                {OPTIMIZE_PLUGINS.map((p) => {
                  const locked = forcedOff.includes(p.id)
                  return (
                    <li key={p.id}>
                      <label className={locked ? styles.pluginLocked : styles.plugin}>
                        <input
                          type="checkbox"
                          checked={!locked && !!settings.plugins[p.id]}
                          disabled={locked}
                          onChange={(e) => setPlugin(p.id, e.target.checked)}
                        />
                        <span className={styles.pluginText}>
                          {p.label}
                          {p.note && <span className={styles.hint}>{p.note}</span>}
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            </details>

            <button className={styles.reset} onClick={() => setSettings(DEFAULT_SETTINGS)}>
              <RotateCcw size={13} />
              Reset to defaults
            </button>
          </div>
        </div>

        <div className={styles.footer}>
          <button className={styles.btn} onClick={copy} disabled={!optimized}>
            {copied ? <Check size={15} /> : <Copy size={15} />}
            {copied ? 'Copied' : 'Copy markup'}
          </button>
          <span className={styles.spacer} />
          <button className={styles.btn} onClick={onClose}>
            Cancel
          </button>
          <button
            className={styles.primary}
            disabled={!optimized}
            onClick={() => {
              downloadSvgString(optimized, filename)
              onClose()
            }}
          >
            <Download size={15} />
            Download SVG
          </button>
        </div>
      </div>
    </div>
  )
}
