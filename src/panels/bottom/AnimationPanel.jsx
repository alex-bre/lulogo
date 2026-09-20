import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Clapperboard, Pause, Play, Repeat, Square, Trash2 } from 'lucide-react'
import { useStore } from '../../state/store'
import { beginHistoryBatch, endHistoryBatch } from '../../state/history'
import { getAnimation, EFFECTS, EFFECT_OPTIONS, EASING_OPTIONS, MIN_CLIP_MS, canMorph } from '../../model/animation'
import { NumberInput, Select } from '../common/Controls'
import ContextMenu from '../common/ContextMenu'
import styles from './AnimationPanel.module.css'

const PPS = 120 // timeline pixels per second
const NAME_W = 148 // track-name column width

const msToX = (ms) => (ms / 1000) * PPS
const xToMs = (x) => (x / PPS) * 1000
const fmt = (ms) => (ms / 1000).toFixed(2)

/**
 * Expandable animation timeline docked at the bottom of the app. One track per
 * animated object; clips are dragged to move and edge-dragged to retime.
 * Playback/scrubbing previews the animation on the canvas without touching the
 * document — clips themselves live in the document, so they undo and save.
 */
export default function AnimationPanel() {
  const anim = useStore((s) => s.ui.anim)
  const doc = useStore((s) => s.document)
  const selection = useStore((s) => s.selection)
  const toggle = useStore((s) => s.toggleAnimPanel)

  const clipCount = doc.animation ? doc.animation.clips.length : 0

  if (!anim.open) {
    return (
      <footer className={`${styles.bar} no-select`}>
        <button className={styles.barBtn} onClick={toggle} title="Open the animation timeline">
          <Clapperboard size={14} />
          Animation
          {clipCount > 0 && <span className={styles.badge}>{clipCount}</span>}
          <ChevronUp size={14} />
        </button>
      </footer>
    )
  }

  return <ExpandedPanel anim={anim} doc={doc} selection={selection} toggle={toggle} />
}

function ExpandedPanel({ anim, doc, selection, toggle }) {
  const animation = getAnimation(doc)
  const playAnim = useStore((s) => s.playAnim)
  const pauseAnim = useStore((s) => s.pauseAnim)
  const stopAnim = useStore((s) => s.stopAnim)
  const toggleLoop = useStore((s) => s.toggleAnimLoop)
  const setAnimTime = useStore((s) => s.setAnimTime)
  const setAnimDuration = useStore((s) => s.setAnimDuration)
  const addEffectClips = useStore((s) => s.addEffectClips)
  const selectClip = useStore((s) => s.selectClip)
  const removeClip = useStore((s) => s.removeClip)
  const removeClipsForNode = useStore((s) => s.removeClipsForNode)

  // Right-click menu for the timeline (delete a clip / a whole object track).
  const [menu, setMenu] = useState(null)
  const onClipMenu = (e, clip) => {
    e.preventDefault()
    e.stopPropagation()
    selectClip(clip.id)
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [{ label: 'Delete effect', icon: <Trash2 size={14} />, danger: true, onClick: () => removeClip(clip.id) }],
    })
  }
  const onTrackMenu = (e, node) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: 'Remove all effects',
          icon: <Trash2 size={14} />,
          danger: true,
          onClick: () => removeClipsForNode(node.id),
        },
      ],
    })
  }

  /* Playback: advance the playhead with requestAnimationFrame while playing. */
  useEffect(() => {
    if (!anim.playing) return
    let raf
    let base = performance.now() - useStore.getState().ui.anim.time
    const tick = (now) => {
      const st = useStore.getState()
      const dur = getAnimation(st.document).duration
      let t = now - base
      if (t >= dur) {
        if (st.ui.anim.loop) {
          base = now - (t % dur)
          t %= dur
        } else {
          st.setAnimTime(dur)
          st.pauseAnim()
          return
        }
      }
      st.setAnimTime(t)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [anim.playing])

  /* Tracks: one row per node that has clips, in first-clip order. */
  const tracks = useMemo(() => {
    const byNode = new Map()
    for (const clip of animation.clips) {
      const node = doc.nodes[clip.nodeId]
      if (!node) continue
      if (!byNode.has(clip.nodeId)) byNode.set(clip.nodeId, { node, clips: [] })
      byNode.get(clip.nodeId).clips.push(clip)
    }
    return [...byNode.values()]
  }, [animation.clips, doc.nodes])

  const timelineW = msToX(animation.duration)
  const selectedClip = anim.selectedClipId ? animation.clips.find((c) => c.id === anim.selectedClipId) : null

  /* Seek by pressing/dragging on the ruler. */
  const rulerRef = useRef(null)
  const onRulerDown = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    const seek = (ev) => setAnimTime(xToMs(ev.clientX - rulerRef.current.getBoundingClientRect().left))
    seek(e)
    const move = (ev) => seek(ev)
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const addEffect = (effect) => {
    if (!effect || !selection.length) return
    addEffectClips(selection, effect)
  }

  /* Ruler ticks: label every second, minor tick every quarter. */
  const ticks = []
  for (let ms = 0; ms <= animation.duration; ms += 250) {
    ticks.push({ ms, major: ms % 1000 === 0 })
  }

  return (
    <footer className={`${styles.panel} no-select`}>
      <div className={styles.header}>
        <button className={styles.iconBtn} onClick={toggle} title="Collapse the timeline">
          <ChevronDown size={15} />
        </button>
        <Clapperboard size={14} />
        <span className={styles.title}>Animation</span>

        <span className={styles.sep} />

        <button className={styles.iconBtn} onClick={anim.playing ? pauseAnim : playAnim} title={anim.playing ? 'Pause' : 'Play'}>
          {anim.playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <button className={styles.iconBtn} onClick={stopAnim} title="Stop and return to the design state">
          <Square size={13} />
        </button>
        <button className={styles.iconBtn} data-active={anim.loop || undefined} onClick={toggleLoop} title="Loop playback">
          <Repeat size={14} />
        </button>
        <span className={styles.time}>
          {fmt(anim.time)}<span className={styles.timeMuted}> / {fmt(animation.duration)}s</span>
        </span>

        <span className={styles.sep} />

        <label className={styles.durationField}>
          Length
          <span className={styles.durationInput}>
            <NumberInput
              value={animation.duration / 1000}
              min={0.5}
              max={120}
              step={0.5}
              onChange={(v) => setAnimDuration(v * 1000)}
              title="Timeline length in seconds"
            />
          </span>
          s
        </label>

        <span className={styles.spacer} />

        <select
          className={styles.addEffect}
          value=""
          disabled={!selection.length}
          title={selection.length ? 'Add an effect to the selected object(s) at the playhead' : 'Select an object on the canvas first'}
          onChange={(e) => addEffect(e.target.value)}
        >
          <option value="" disabled>
            ＋ Add effect…
          </option>
          {EFFECT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.body}>
        {tracks.length === 0 ? (
          <div className={styles.empty}>
            Select an object on the canvas, then use <b>＋ Add effect</b> to animate it — fade, slide, bounce, pulse,
            spin, or morph it into another shape.
          </div>
        ) : (
          <div className={styles.scroll}>
            <div className={styles.rows} style={{ width: NAME_W + timelineW + 24 }}>
              <div className={`${styles.row} ${styles.headRow}`}>
                <div className={`${styles.name} ${styles.corner}`}>Object</div>
                <div ref={rulerRef} className={styles.ruler} style={{ width: timelineW }} onPointerDown={onRulerDown}>
                  {ticks.map((t) => (
                    <span
                      key={t.ms}
                      className={t.major ? styles.tickMajor : styles.tick}
                      style={{ left: msToX(t.ms) }}
                    >
                      {t.major ? `${t.ms / 1000}s` : ''}
                    </span>
                  ))}
                </div>
              </div>

              {tracks.map(({ node, clips }) => (
                <TrackRow
                  key={node.id}
                  node={node}
                  clips={clips}
                  timelineW={timelineW}
                  selectedId={anim.selectedClipId}
                  onClipMenu={onClipMenu}
                  onTrackMenu={onTrackMenu}
                />
              ))}

              <div className={styles.playhead} style={{ left: NAME_W + msToX(anim.time) }}>
                <div className={styles.playheadKnob} />
              </div>
            </div>
          </div>
        )}
      </div>

      {selectedClip && <ClipInspector clip={selectedClip} doc={doc} onClose={() => selectClip(null)} />}

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </footer>
  )
}

function TrackRow({ node, clips, timelineW, selectedId, onClipMenu, onTrackMenu }) {
  const setSelection = useStore((s) => s.setSelection)
  return (
    <div className={styles.row}>
      <button
        className={styles.name}
        onClick={() => setSelection([node.id])}
        onContextMenu={(e) => onTrackMenu(e, node)}
        title="Select this object on the canvas (right-click to remove its effects)"
      >
        {node.name}
      </button>
      <div className={styles.lane} style={{ width: timelineW }}>
        {clips.map((c) => (
          <ClipBlock key={c.id} clip={c} selected={c.id === selectedId} onClipMenu={onClipMenu} />
        ))}
      </div>
    </div>
  )
}

/** A clip block: drag to move, drag either edge to retime. */
function ClipBlock({ clip, selected, onClipMenu }) {
  const selectClip = useStore((s) => s.selectClip)
  const updateClip = useStore((s) => s.updateClip)

  const onPointerDown = (e, mode) => {
    if (e.button !== 0) return // left-drag only; right-click opens the context menu
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    selectClip(clip.id)
    beginHistoryBatch()
    const x0 = e.clientX
    const orig = { start: clip.start, duration: clip.duration }
    const move = (ev) => {
      const dms = xToMs(ev.clientX - x0)
      if (mode === 'move') {
        updateClip(clip.id, { start: Math.round(orig.start + dms) })
      } else if (mode === 'right') {
        updateClip(clip.id, { duration: Math.round(orig.duration + dms) })
      } else {
        const start = Math.max(0, Math.min(orig.start + dms, orig.start + orig.duration - MIN_CLIP_MS))
        updateClip(clip.id, { start: Math.round(start), duration: Math.round(orig.start + orig.duration - start) })
      }
    }
    const up = () => {
      endHistoryBatch()
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const fx = EFFECTS[clip.effect]
  return (
    <div
      className={styles.clip}
      data-selected={selected || undefined}
      style={{ left: msToX(clip.start), width: Math.max(10, msToX(clip.duration)) }}
      onPointerDown={(e) => onPointerDown(e, 'move')}
      onContextMenu={(e) => onClipMenu(e, clip)}
      title={`${fx ? fx.label : clip.effect} · ${fmt(clip.start)}s – ${fmt(clip.start + clip.duration)}s`}
    >
      <span className={styles.clipHandle} data-side="l" onPointerDown={(e) => onPointerDown(e, 'left')} />
      <span className={styles.clipLabel}>{fx ? fx.label : clip.effect}</span>
      <span className={styles.clipHandle} data-side="r" onPointerDown={(e) => onPointerDown(e, 'right')} />
    </div>
  )
}

/** Bottom strip editing the selected clip: timing, easing, effect parameters. */
function ClipInspector({ clip, doc, onClose }) {
  const updateClip = useStore((s) => s.updateClip)
  const updateClipParams = useStore((s) => s.updateClipParams)
  const removeClip = useStore((s) => s.removeClip)

  const node = doc.nodes[clip.nodeId]
  const fx = EFFECTS[clip.effect]
  const p = clip.params || {}

  // Morph target: any other morphable node in the document.
  const morphTargets = useMemo(() => {
    if (clip.effect !== 'morph') return []
    return Object.values(doc.nodes)
      .filter((n) => n.id !== clip.nodeId && canMorph(n))
      .map((n) => ({ value: n.id, label: n.name }))
  }, [clip.effect, clip.nodeId, doc.nodes])

  return (
    <div className={styles.inspector}>
      <span className={styles.inspTitle}>
        {fx ? fx.label : clip.effect}
        <span className={styles.inspNode}> · {node ? node.name : '?'}</span>
      </span>

      <label className={styles.inspField}>
        Start
        <NumberInput value={clip.start / 1000} min={0} step={0.1} onChange={(v) => updateClip(clip.id, { start: v * 1000 })} />
        s
      </label>
      <label className={styles.inspField}>
        Duration
        <NumberInput
          value={clip.duration / 1000}
          min={MIN_CLIP_MS / 1000}
          step={0.1}
          onChange={(v) => updateClip(clip.id, { duration: v * 1000 })}
        />
        s
      </label>
      <label className={styles.inspField}>
        Easing
        <Select value={clip.easing} options={EASING_OPTIONS} onChange={(v) => updateClip(clip.id, { easing: v })} />
      </label>

      {clip.effect === 'slideIn' && (
        <>
          <label className={styles.inspField}>
            From
            <Select
              value={p.direction || 'left'}
              options={[
                { value: 'left', label: 'Left' },
                { value: 'right', label: 'Right' },
                { value: 'up', label: 'Top' },
                { value: 'down', label: 'Bottom' },
              ]}
              onChange={(v) => updateClipParams(clip.id, { direction: v })}
            />
          </label>
          <label className={styles.inspField}>
            Distance
            <NumberInput value={p.distance ?? 240} min={10} step={10} onChange={(v) => updateClipParams(clip.id, { distance: v })} />
          </label>
        </>
      )}
      {clip.effect === 'bounce' && (
        <>
          <label className={styles.inspField}>
            Height
            <NumberInput value={p.height ?? 60} min={1} step={5} onChange={(v) => updateClipParams(clip.id, { height: v })} />
          </label>
          <label className={styles.inspField}>
            Bounces
            <NumberInput value={p.bounces ?? 3} min={1} max={10} step={1} onChange={(v) => updateClipParams(clip.id, { bounces: Math.round(v) })} />
          </label>
        </>
      )}
      {clip.effect === 'pulse' && (
        <>
          <label className={styles.inspField}>
            Scale
            <NumberInput value={p.scale ?? 1.25} min={0.1} max={4} step={0.05} onChange={(v) => updateClipParams(clip.id, { scale: v })} />
          </label>
          <label className={styles.inspField}>
            Repeats
            <NumberInput value={p.repeats ?? 2} min={1} max={10} step={1} onChange={(v) => updateClipParams(clip.id, { repeats: Math.round(v) })} />
          </label>
        </>
      )}
      {clip.effect === 'spin' && (
        <label className={styles.inspField}>
          Turns
          <NumberInput value={p.turns ?? 1} min={-10} max={10} step={0.25} onChange={(v) => updateClipParams(clip.id, { turns: v })} />
        </label>
      )}
      {clip.effect === 'morph' && (
        <label className={styles.inspField}>
          Into
          <Select
            value={p.targetId || ''}
            options={[{ value: '', label: 'Choose a shape…' }, ...morphTargets]}
            onChange={(v) => updateClipParams(clip.id, { targetId: v || null })}
          />
        </label>
      )}

      <span className={styles.spacer} />
      <button className={styles.iconBtn} title="Delete this effect" onClick={() => removeClip(clip.id)}>
        <Trash2 size={14} />
      </button>
      <button className={styles.iconBtn} title="Close" onClick={onClose}>
        <ChevronDown size={14} />
      </button>
    </div>
  )
}
