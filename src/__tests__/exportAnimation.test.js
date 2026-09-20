import { describe, it, expect } from 'vitest'
import { createDocument } from '../model/document'
import { createRect, addNode } from '../model/nodes'
import { createClip } from '../model/animation'
import { serializeDocument } from '../io/serialize'
import { serializeAnimatedDocument } from '../io/exportAnimatedSvg'

function docWithRect() {
  const doc = createDocument()
  const rect = createRect({ x: 100, y: 100, width: 200, height: 100 })
  addNode(doc, rect)
  return { doc, rect }
}

describe('animated SVG export', () => {
  it('exports unchanged when there is no animation', () => {
    const { doc } = docWithRect()
    expect(serializeAnimatedDocument(doc)).toBe(serializeDocument(doc))

    doc.animation = { duration: 5000, clips: [] }
    expect(serializeAnimatedDocument(doc)).not.toContain('<style>')
  })

  it('bakes a fade into keyframes on a class-wrapped node', () => {
    const { doc, rect } = docWithRect()
    doc.animation = { duration: 5000, clips: [{ ...createClip(rect.id, 'fadeIn', 1000, 1000), easing: 'linear' }] }

    const svg = serializeAnimatedDocument(doc)
    expect(svg).toContain('<style>')
    expect(svg).toContain('.a0 { animation: ka0 5000ms linear infinite both; }')
    expect(svg).toContain('@keyframes ka0')
    expect(svg).toContain('0% { opacity: 0; }') // hidden before the clip
    expect(svg).toContain('100% { opacity: 1; }') // resting state at the end
    expect(svg).toMatch(/<g class="a0">\s*<rect/) // wrapper around the original markup
    expect(svg).toContain('prefers-reduced-motion')
  })

  it('one run without looping holds the end state', () => {
    const { doc, rect } = docWithRect()
    doc.animation = { duration: 2000, clips: [createClip(rect.id, 'fadeOut', 0, 1000)] }

    const svg = serializeAnimatedDocument(doc, { loop: false })
    expect(svg).toContain('2000ms linear 1 both')
    expect(svg).not.toContain('infinite')
  })

  it('bakes transforms with the pivot at the node center', () => {
    const { doc, rect } = docWithRect()
    doc.animation = { duration: 2000, clips: [{ ...createClip(rect.id, 'spin', 0, 2000), easing: 'linear' }] }

    const svg = serializeAnimatedDocument(doc)
    // rect center is (200, 150); mid-timeline the linear spin is at 180deg,
    // and the final key holds 360deg so a loop never interpolates backwards.
    expect(svg).toContain('translate(200px, 150px)')
    expect(svg).toContain('rotate(180deg)')
    expect(svg).toContain('100% { transform: translate(0px, 0px) translate(200px, 150px) rotate(360deg) scale(1) translate(-200px, -150px); }')
  })

  it('does not touch the live document', () => {
    const { doc, rect } = docWithRect()
    doc.animation = { duration: 5000, clips: [createClip(rect.id, 'fadeIn', 0, 1000)] }
    const before = JSON.stringify(doc)

    serializeAnimatedDocument(doc)
    expect(JSON.stringify(doc)).toBe(before)
    expect(doc.rootOrder).toEqual([rect.id]) // no wrapper leaked in
  })

  it('skips nodes whose only effect cannot be baked (morph without layout engine)', () => {
    // jsdom has no getTotalLength, so outline sampling returns null and the
    // morph channel is skipped — the export falls back to a static file.
    const doc = createDocument()
    const a = createRect({ x: 0, y: 0, width: 10, height: 10 })
    const b = createRect({ x: 50, y: 0, width: 10, height: 10 })
    addNode(doc, a)
    addNode(doc, b)
    doc.animation = { duration: 2000, clips: [{ ...createClip(a.id, 'morph', 0, 1000), params: { targetId: b.id } }] }

    const svg = serializeAnimatedDocument(doc)
    expect(svg).not.toContain('<style>')
    expect(svg).toContain('<rect')
  })
})
