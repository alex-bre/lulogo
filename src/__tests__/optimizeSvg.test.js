import { describe, it, expect } from 'vitest'
import { createDocument } from '../model/document'
import { createRect, createEllipse, addNode } from '../model/nodes'
import { createClip } from '../model/animation'
import { serializeDocument } from '../io/serialize'
import { serializeAnimatedDocument } from '../io/exportAnimatedSvg'
import {
  DEFAULT_SETTINGS,
  OPTIMIZE_PLUGINS,
  byteLength,
  forcedOffPlugins,
  formatBytes,
  loadSvgo,
  optimizeSvg,
  resolveSettings,
} from '../io/optimizeSvg'

function demoDoc() {
  const doc = createDocument()
  const rect = createRect({ x: 100.123456, y: 100.987654, width: 200, height: 100 })
  rect.style = { ...rect.style, fill: '#ff0000' }
  addNode(doc, rect)
  addNode(doc, createEllipse({ cx: 300, cy: 200, rx: 40, ry: 40 }))
  return { doc, rect }
}

describe('SVG optimizer', () => {
  it('every catalogued plugin exists in the installed SVGO', async () => {
    const { builtinPlugins } = await loadSvgo()
    const known = new Set(builtinPlugins.map((p) => p.name))
    for (const p of OPTIMIZE_PLUGINS) expect([p.id, known.has(p.id)]).toEqual([p.id, true])
  })

  it('shrinks an exported document without losing the viewBox', async () => {
    const source = serializeDocument(demoDoc().doc)
    const { data } = await optimizeSvg(source)

    expect(byteLength(data)).toBeLessThan(byteLength(source))
    expect(data).toContain('viewBox="0 0 ')
    expect(data).toContain('red') // convertColors shortened #ff0000
    expect(data).not.toContain('100.123456') // rounded to the default precision
  })

  it('honours the precision setting', async () => {
    const source = serializeDocument(demoDoc().doc)
    const coarse = await optimizeSvg(source, { ...DEFAULT_SETTINGS, precision: 0 })
    const fine = await optimizeSvg(source, { ...DEFAULT_SETTINGS, precision: 8 })
    expect(byteLength(coarse.data)).toBeLessThan(byteLength(fine.data))
  })

  it('leaves plugins the user switched off alone', async () => {
    const source = serializeDocument(demoDoc().doc)
    const kept = await optimizeSvg(source, {
      ...DEFAULT_SETTINGS,
      plugins: { ...DEFAULT_SETTINGS.plugins, convertShapeToPath: false, convertEllipseToCircle: false },
    })
    expect(kept.data).toContain('<rect')

    const converted = await optimizeSvg(source)
    expect(converted.data).not.toContain('<rect')
  })

  it('removes the viewBox only when asked', async () => {
    const source = serializeDocument(demoDoc().doc)
    const { data } = await optimizeSvg(source, {
      ...DEFAULT_SETTINGS,
      plugins: { ...DEFAULT_SETTINGS.plugins, removeViewBox: true },
    })
    expect(data).not.toContain('viewBox')
  })

  it('keeps a baked-in animation working', async () => {
    const { doc, rect } = demoDoc()
    doc.animation = { duration: 2000, clips: [{ ...createClip(rect.id, 'spin', 0, 2000), easing: 'linear' }] }
    const source = serializeAnimatedDocument(doc)
    expect(forcedOffPlugins(source)).toEqual(['inlineStyles'])

    const { data, resolved } = await optimizeSvg(source)
    expect(resolved.plugins.inlineStyles).toBe(false)
    expect(data).toContain('@keyframes ka0')
    // The class the keyframes target survives on some element, so the export
    // still animates rather than merely still parsing.
    expect(data).toMatch(/class="a0"/)
    expect(byteLength(data)).toBeLessThan(byteLength(source))
  })

  it('normalises stored settings', () => {
    const s = resolveSettings({ precision: 99, transformPrecision: -4, plugins: { nonsensePlugin: true } })
    expect(s.precision).toBe(8)
    expect(s.transformPrecision).toBe(0)
    expect(s.plugins.nonsensePlugin).toBeUndefined()
    expect(s.plugins.removeComments).toBe(true)
  })

  it('formats byte counts', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.00 kB')
    expect(formatBytes(null)).toBe('—')
  })
})
