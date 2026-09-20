import { serializeDocument } from './serialize'
import { embedProjectInSvg } from './embedSource'
import { downloadBlob } from './download'
import { clipsByNode, accumulateClipsAt, getAnimation, nodeToLocalD, morphD, canMorph } from '../model/animation'
import { nodeBounds } from '../model/bbox'

// Animated SVG export: bake the timeline into CSS @keyframes embedded in the
// exported file. Keyframes are *sampled* from the same evaluator that drives
// the canvas preview (accumulateClipsAt), so easing curves, bounces, and
// stacked effects export exactly as previewed and no runtime script is needed.
//
// Per animated node the file gains a wrapper <g class="aN"> carrying the
// opacity/transform animation (a wrapper, because a CSS transform would
// override the node's own transform attribute). Morphed shapes are exported as
// <path> and additionally get a `d: path(...)` keyframe animation; every d key
// uses the same sampled-polygon structure so browsers can interpolate them.
// Viewers without CSS animation support just show the static artwork.

const r3 = (n) => Math.round(n * 1000) / 1000
const px = (n) => `${r3(n)}px`

// Enough samples to trace each effect's curve; oscillating effects get more.
function samplesForClip(clip) {
  const p = clip.params || {}
  const cycles = clip.effect === 'bounce' ? p.bounces : clip.effect === 'pulse' ? p.repeats : 1
  return Math.min(120, Math.max(24, Math.round((cycles || 1) * 16)))
}

// Sorted unique sample times (ms) for one node's clips: timeline endpoints,
// clip boundaries, and a dense grid inside each clip. Values are constant
// between clips, so boundary keys alone are exact there.
function sampleTimes(clips, duration) {
  const times = new Set([0, duration])
  for (const clip of clips) {
    const n = samplesForClip(clip)
    for (let j = 0; j <= n; j++) {
      const t = clip.start + (clip.duration * j) / n
      if (t >= 0 && t <= duration) times.add(t)
    }
    if (clip.start >= 0 && clip.start <= duration) times.add(clip.start)
    const end = clip.start + clip.duration
    if (end >= 0 && end <= duration) times.add(end)
  }
  return [...times].sort((a, b) => a - b)
}

function transformValue(a, cx, cy) {
  return (
    `translate(${px(a.dx)}, ${px(a.dy)}) translate(${px(cx)}, ${px(cy)}) ` +
    `rotate(${r3(a.rotate)}deg) scale(${r3(a.scale)}) translate(${px(-cx)}, ${px(-cy)})`
  )
}

// Emit a @keyframes rule from per-sample channel values. A property omitted
// from a keyframe interpolates between the keyframes that do specify it, so
// interior keys of constant runs are dropped (only the run's endpoints are
// kept) — this is what keeps the exported CSS compact.
function buildKeyframes(name, times, duration, channels) {
  const last = times.length - 1
  const seen = new Set()
  const lines = []
  for (let i = 0; i < times.length; i++) {
    const pct = r3((times[i] / duration) * 100)
    if (seen.has(pct)) continue
    seen.add(pct)
    const decls = []
    for (const ch of channels) {
      const v = ch.values[i]
      if (i === 0 || i === last || v !== ch.values[i - 1] || v !== ch.values[i + 1]) decls.push(`${ch.prop}: ${v};`)
    }
    if (decls.length) lines.push(`    ${pct}% { ${decls.join(' ')} }`)
  }
  return `    @keyframes ${name} {\n${lines.join('\n')}\n    }`
}

const IDENTITY = { opacity: 1, dx: 0, dy: 0, scale: 1, rotate: 0, d: null }

/**
 * Serialize the document with its animation baked in as CSS keyframes.
 * `loop` mirrors the timeline panel's loop toggle: infinite playback vs. one
 * run that holds its final state. Documents without clips export unchanged.
 */
export function serializeAnimatedDocument(doc, { loop = true } = {}) {
  const byNode = clipsByNode(doc)
  const duration = getAnimation(doc).duration
  if (!byNode.size) return serializeDocument(doc)

  // Work on a clone: the export inserts wrapper groups and converts morphed
  // shapes to paths without touching the live document.
  const out = JSON.parse(JSON.stringify(doc))
  const cssParts = []
  const animatedClasses = []
  let i = 0

  for (const [nodeId, clips] of byNode) {
    const node = doc.nodes[nodeId]
    if (node.hidden) continue

    // Sample the combined effect curve for this node across the timeline.
    const times = sampleTimes(clips, duration)
    const samples = times.map((t) => ({ t, a: accumulateClipsAt(clips, node, doc.nodes, t) || IDENTITY }))

    const useOpacity = samples.some(({ a }) => a.opacity !== 1)
    const useTransform = samples.some(({ a }) => a.dx || a.dy || a.rotate || a.scale !== 1)

    // Morph: only when the target still exists and outline sampling works
    // (it needs a real layout engine); base key = the source outline in the
    // same sampled-polygon form as the animated keys, so they interpolate.
    let morphBase = null
    const morphClip = clips.find(
      (c) => c.effect === 'morph' && c.params && c.params.targetId && canMorph(doc.nodes[c.params.targetId]),
    )
    if (morphClip && canMorph(node)) {
      const fromD = nodeToLocalD(node)
      const toD = nodeToLocalD(doc.nodes[morphClip.params.targetId])
      if (fromD && toD) morphBase = morphD(fromD, toD, 0)
    }

    if (!useOpacity && !useTransform && !morphBase) continue

    const timing = `${Math.round(duration)}ms linear ${loop ? 'infinite' : '1'} both`

    if (useOpacity || useTransform) {
      const b = nodeBounds(node, doc.nodes)
      const cx = b ? b.x + b.width / 2 : 0
      const cy = b ? b.y + b.height / 2 : 0
      const cls = `a${i}`
      const channels = []
      if (useOpacity)
        channels.push({ prop: 'opacity', values: samples.map(({ a }) => `${r3(Math.max(0, Math.min(1, a.opacity)))}`) })
      if (useTransform)
        channels.push({ prop: 'transform', values: samples.map(({ a }) => transformValue(a, cx, cy)) })
      cssParts.push(
        `    .${cls} { animation: k${cls} ${timing}; }\n` + buildKeyframes(`k${cls}`, times, duration, channels),
      )
      animatedClasses.push(`.${cls}`)

      // Wrap the node in <g class="aN"> so the CSS transform composes with
      // (instead of overriding) the node's own transform attribute.
      const cloneNode = out.nodes[nodeId]
      const wrapId = `${nodeId}_aw`
      const wrapper = {
        id: wrapId,
        type: 'group',
        name: 'anim',
        parent: cloneNode.parent,
        rotation: 0,
        flipX: false,
        flipY: false,
        locked: false,
        hidden: false,
        style: {},
        children: [nodeId],
        exportClass: cls,
      }
      out.nodes[wrapId] = wrapper
      const container =
        cloneNode.parent && out.nodes[cloneNode.parent] ? out.nodes[cloneNode.parent].children : out.rootOrder
      container.splice(container.indexOf(nodeId), 1, wrapId)
      cloneNode.parent = wrapId
    }

    if (morphBase) {
      const mcls = `m${i}`
      const dChannel = { prop: 'd', values: samples.map(({ a }) => `path('${a.d || morphBase}')`) }
      cssParts.push(
        `    .${mcls} { animation: k${mcls} ${timing}; }\n` + buildKeyframes(`k${mcls}`, times, duration, [dChannel]),
      )
      animatedClasses.push(`.${mcls}`)

      // Export the morphed shape as a real <path> (its static d is the exact
      // outline; the keyframes swap in the sampled form while animating).
      const cloneNode = out.nodes[nodeId]
      cloneNode.type = 'path'
      cloneNode.d = nodeToLocalD(node)
      cloneNode.exportClass = mcls
    }

    i += 1
  }

  if (!cssParts.length) return serializeDocument(doc)

  cssParts.push(`    @media (prefers-reduced-motion: reduce) { ${animatedClasses.join(', ')} { animation: none; } }`)
  return serializeDocument(out, { css: cssParts.join('\n') })
}

/** Serialize with baked-in animation and download. */
export function downloadAnimatedSvg(doc, { loop = true, filename = 'animation.svg', embedSource = false } = {}) {
  let svg = serializeAnimatedDocument(doc, { loop })
  if (embedSource) svg = embedProjectInSvg(svg, doc)
  downloadBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), filename)
}
