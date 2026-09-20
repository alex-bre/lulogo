import { describe, it, expect } from 'vitest'
import { useStore } from '../state/store'
import { createDocument } from '../model/document'
import { createRect, createEllipse, addNode } from '../model/nodes'
import { evaluateAnimation, createClip, getAnimation, nodeToLocalD, EASINGS } from '../model/animation'

function reset() {
  useStore.setState({ document: createDocument(), selection: [], past: [], future: [] })
  useStore.setState({ past: [], future: [] })
}

function docWithRect() {
  const doc = createDocument()
  const rect = createRect({ x: 100, y: 100, width: 200, height: 100 })
  addNode(doc, rect)
  return { doc, rect }
}

describe('animation model', () => {
  it('tolerates documents without an animation block', () => {
    const doc = createDocument()
    expect(getAnimation(doc).clips).toEqual([])
    expect(evaluateAnimation(doc, 1000)).toBeNull()
  })

  it('fade in: hidden before the clip, ramping during, untouched after', () => {
    const { doc, rect } = docWithRect()
    doc.animation = { duration: 5000, clips: [{ ...createClip(rect.id, 'fadeIn', 1000, 1000), easing: 'linear' }] }

    expect(evaluateAnimation(doc, 0)[rect.id].opacity).toBe(0)
    expect(evaluateAnimation(doc, 1500)[rect.id].opacity).toBeCloseTo(0.5)
    expect(evaluateAnimation(doc, 3000)).toBeNull() // no override past the clip
  })

  it('fade out: untouched before, hidden after', () => {
    const { doc, rect } = docWithRect()
    doc.animation = { duration: 5000, clips: [createClip(rect.id, 'fadeOut', 1000, 1000)] }

    expect(evaluateAnimation(doc, 500)).toBeNull()
    expect(evaluateAnimation(doc, 4000)[rect.id].opacity).toBe(0)
  })

  it('slide in offsets toward rest and bounce returns to base at the end', () => {
    const { doc, rect } = docWithRect()
    doc.animation = {
      duration: 5000,
      clips: [
        { ...createClip(rect.id, 'slideIn', 0, 1000), easing: 'linear' },
        { ...createClip(rect.id, 'bounce', 2000, 1000), easing: 'linear' },
      ],
    }

    // Before rest: shifted by the full distance while hidden.
    expect(evaluateAnimation(doc, 0)[rect.id].transform).toContain('translate(-240 0)')
    // Bounce midway: some vertical offset...
    expect(evaluateAnimation(doc, 2400)[rect.id].transform).toContain('translate(')
    // ...but exactly at its end the shape is back at base (no override at all).
    expect(evaluateAnimation(doc, 3000)).toBeNull()
  })

  it('spin rotates about the node center and combines with pulse scaling', () => {
    const { doc, rect } = docWithRect()
    doc.animation = {
      duration: 5000,
      clips: [
        { ...createClip(rect.id, 'spin', 0, 1000), easing: 'linear' },
        { ...createClip(rect.id, 'pulse', 0, 1000), easing: 'linear', params: { scale: 2, repeats: 1 } },
      ],
    }
    const t = evaluateAnimation(doc, 500)[rect.id].transform
    expect(t).toContain('rotate(180 200 150)') // rect center = (200, 150)
    expect(t).toContain('scale(2)') // |sin(pi/2)| peak
  })

  it('easings are monotone ramps from 0 to 1', () => {
    for (const ease of Object.values(EASINGS)) {
      expect(ease(0)).toBeCloseTo(0)
      expect(ease(1)).toBeCloseTo(1)
      expect(ease(0.75)).toBeGreaterThan(ease(0.25))
    }
  })

  it('builds local outlines for morphable shapes', () => {
    expect(nodeToLocalD(createRect({ x: 0, y: 0, width: 10, height: 10 }))).toMatch(/^M 0 0 L 10 0/)
    expect(nodeToLocalD(createEllipse({ cx: 5, cy: 5, rx: 5, ry: 5 }))).toContain('A 5 5')
    expect(nodeToLocalD(createRect({ x: 0, y: 0, width: 10, height: 10, rx: 2 }))).toContain('A 2 2')
  })
})

describe('animation store actions', () => {
  it('adds clips at the playhead for the selection and selects the first', () => {
    reset()
    const rect = createRect({ x: 0, y: 0, width: 10, height: 10 })
    useStore.getState().addImportedNodes([rect])
    useStore.getState().setAnimTime(1500)
    useStore.getState().addEffectClips([rect.id], 'fadeIn')

    const anim = useStore.getState().document.animation
    expect(anim.clips).toHaveLength(1)
    expect(anim.clips[0].nodeId).toBe(rect.id)
    expect(anim.clips[0].effect).toBe('fadeIn')
    expect(anim.clips[0].start).toBe(1500)
    expect(useStore.getState().ui.anim.selectedClipId).toBe(anim.clips[0].id)
  })

  it('updates and clamps clip timing', () => {
    reset()
    const rect = createRect({ x: 0, y: 0, width: 10, height: 10 })
    useStore.getState().addImportedNodes([rect])
    useStore.getState().addEffectClips([rect.id], 'bounce')
    const id = useStore.getState().document.animation.clips[0].id

    useStore.getState().updateClip(id, { start: -500, duration: 10 })
    const clip = useStore.getState().document.animation.clips[0]
    expect(clip.start).toBe(0)
    expect(clip.duration).toBe(100) // MIN_CLIP_MS
  })

  it('deleting a node prunes its clips', () => {
    reset()
    const rect = createRect({ x: 0, y: 0, width: 10, height: 10 })
    useStore.getState().addImportedNodes([rect])
    useStore.getState().addEffectClips([rect.id], 'fadeIn')
    expect(useStore.getState().document.animation.clips).toHaveLength(1)

    useStore.getState().removeNodes([rect.id])
    expect(useStore.getState().document.animation.clips).toHaveLength(0)
  })

  it('playback state: play/scrub previews, stop rewinds and exits preview', () => {
    reset()
    useStore.getState().setAnimDuration(2000)
    useStore.getState().setAnimTime(99999)
    expect(useStore.getState().ui.anim.time).toBe(2000) // clamped to duration
    expect(useStore.getState().ui.anim.previewing).toBe(true)

    useStore.getState().playAnim() // at the end -> restarts from 0
    expect(useStore.getState().ui.anim.time).toBe(0)
    expect(useStore.getState().ui.anim.playing).toBe(true)

    useStore.getState().stopAnim()
    const a = useStore.getState().ui.anim
    expect(a.playing).toBe(false)
    expect(a.previewing).toBe(false)
    expect(a.time).toBe(0)
  })

  it('removeClip deletes the clip and clears its selection', () => {
    reset()
    const rect = createRect({ x: 0, y: 0, width: 10, height: 10 })
    useStore.getState().addImportedNodes([rect])
    useStore.getState().addEffectClips([rect.id], 'spin')
    const id = useStore.getState().document.animation.clips[0].id

    useStore.getState().removeClip(id)
    expect(useStore.getState().document.animation.clips).toHaveLength(0)
    expect(useStore.getState().ui.anim.selectedClipId).toBeNull()
  })
})
