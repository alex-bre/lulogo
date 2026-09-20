import { useState } from 'react'
import { Blend, Paintbrush, Plus, X, Italic, AlignLeft, AlignCenter, AlignRight, Copy, ClipboardPaste, Spline } from 'lucide-react'
import { useStore } from '../../../state/store'
import { selectedLeafNodes, commonStyle, common } from '../../../state/selectors'
import { genId } from '../../../model/nodes'
import { FONT_FAMILIES, FONT_WEIGHTS } from '../../../model/fonts'
import { lineHeightOf, letterSpacingOf, widthScaleOf } from '../../../model/textMetrics'
import { outlineTextNodes } from '../../../io/textToPath'
import { Field, Group, NumberInput, ColorInput, Range, IconButton, IconRow, Select } from '../../common/Controls'
import styles from './StyleTab.module.css'

const gradIdOf = (fill) => {
  const m = typeof fill === 'string' && fill.match(/^url\(#(.+)\)$/)
  return m ? m[1] : null
}

// Hex color + 0..1 opacity → rgba(), so the CSS gradient preview shows
// transparency the same way the rendered SVG does. Non-hex colors pass through.
const withAlpha = (color, opacity) => {
  const a = opacity == null ? 1 : opacity
  if (typeof color !== 'string' || color[0] !== '#') return color
  let hex = color.slice(1)
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('')
  if (hex.length !== 6) return color
  const n = parseInt(hex, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

const LINE_CAPS = [
  { value: 'butt', label: 'Butt' },
  { value: 'round', label: 'Round' },
  { value: 'square', label: 'Square' },
]

const LINE_JOINS = [
  { value: 'miter', label: 'Miter' },
  { value: 'round', label: 'Round' },
  { value: 'bevel', label: 'Bevel' },
]

export default function StyleTab() {
  // Outlining is async — the font file has to be fetched and parsed — so the
  // button reports progress rather than freezing on a big selection.
  const [outlining, setOutlining] = useState(false)
  const doc = useStore((s) => s.document)
  const selection = useStore((s) => s.selection)
  const updateStyle = useStore((s) => s.updateStyle)
  const updateGeometry = useStore((s) => s.updateGeometry)
  const upsertGradient = useStore((s) => s.upsertGradient)
  const updateText = useStore((s) => s.updateText)
  const copyStyle = useStore((s) => s.copyStyle)
  const pasteStyle = useStore((s) => s.pasteStyle)
  const hasStyleClip = useStore((s) => s.ui.hasStyleClip)
  const applyTextToPaths = useStore((s) => s.applyTextToPaths)

  const nodes = selectedLeafNodes(doc, selection)
  if (!nodes.length) {
    return <p className={styles.empty}>Select an object to edit its style.</p>
  }
  const textNodes = nodes.filter((n) => n.type === 'text')
  const rectNodes = nodes.filter((n) => n.type === 'rect')

  const fill = commonStyle(nodes, 'fill')
  const stroke = commonStyle(nodes, 'stroke')
  const strokeWidth = commonStyle(nodes, 'strokeWidth')
  const lineCap = commonStyle(nodes, 'lineCap') ?? 'butt'
  const lineJoin = commonStyle(nodes, 'lineJoin') ?? 'miter'
  const opacity = commonStyle(nodes, 'opacity') ?? 1
  const gid = gradIdOf(fill)
  const grad = gid ? doc.defs.gradients[gid] : null

  const toGradient = () => {
    const id = genId('grad')
    const base = typeof fill === 'string' && fill.startsWith('#') ? fill : '#5b8cff'
    upsertGradient({
      id,
      type: 'linear',
      angle: 90,
      stops: [
        { offset: 0, color: base, opacity: 1 },
        { offset: 1, color: '#ffffff', opacity: 1 },
      ],
    })
    updateStyle(selection, { fill: `url(#${id})` })
  }
  const toSolid = () => updateStyle(selection, { fill: grad?.stops?.[0]?.color || '#888888' })

  const editGrad = (patch) => upsertGradient({ ...grad, ...patch })
  const editStop = (i, patch) => editGrad({ stops: grad.stops.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) })
  const addStop = () => {
    const stops = [...grad.stops, { offset: 0.5, color: '#888888', opacity: 1 }].sort((a, b) => a.offset - b.offset)
    editGrad({ stops })
  }
  const removeStop = (i) => grad.stops.length > 2 && editGrad({ stops: grad.stops.filter((_, idx) => idx !== i) })

  // Outline the selected text into paths, in the document. Empty and locked
  // nodes can't be converted, so they never reach the store; anything whose font
  // won't load is reported by outlineTextNodes and stays text.
  const outlinable = textNodes.filter((n) => n.text && !n.locked)
  const toPaths = () => {
    if (outlining || !outlinable.length) return
    setOutlining(true)
    outlineTextNodes(outlinable)
      .then(applyTextToPaths)
      .catch((e) => console.warn('text→paths failed', e))
      .finally(() => setOutlining(false))
  }

  const cssStops = grad
    ? grad.stops.map((s) => `${withAlpha(s.color, s.opacity)} ${Math.round(s.offset * 100)}%`).join(', ')
    : ''
  const previewBg = grad
    ? grad.type === 'linear'
      ? `linear-gradient(${(grad.angle || 0)}deg, ${cssStops})`
      : `radial-gradient(circle, ${cssStops})`
    : ''

  return (
    <>
      <div className={styles.styleActions}>
        <button className={styles.actionBtn} onClick={copyStyle} title="Copy this object's style">
          <Copy size={13} /> Copy style
        </button>
        <button
          className={styles.actionBtn}
          onClick={() => pasteStyle(selection)}
          disabled={!hasStyleClip}
          title="Apply the copied style"
        >
          <ClipboardPaste size={13} /> Paste style
        </button>
      </div>

      <Group
        title="Fill"
        right={
          grad ? (
            <IconButton title="Use solid color" onClick={toSolid}>
              <Paintbrush size={14} />
            </IconButton>
          ) : (
            <IconButton title="Use gradient" onClick={toGradient}>
              <Blend size={14} />
            </IconButton>
          )
        }
      >
        {grad ? (
          <div className={styles.gradient}>
            <div className={styles.typeRow}>
              <button
                className={styles.typeBtn}
                data-active={grad.type === 'linear' || undefined}
                onClick={() => editGrad({ type: 'linear' })}
              >
                Linear
              </button>
              <button
                className={styles.typeBtn}
                data-active={grad.type === 'radial' || undefined}
                onClick={() => editGrad({ type: 'radial' })}
              >
                Radial
              </button>
            </div>
            <div className={styles.preview}>
              <div className={styles.previewFill} style={{ background: previewBg }} />
            </div>
            {grad.type === 'linear' && (
              <Field label="Angle">
                <NumberInput value={grad.angle} step={5} onChange={(v) => editGrad({ angle: v })} />
              </Field>
            )}
            <div className={styles.stops}>
              {grad.stops.map((s, i) => (
                <div key={i} className={styles.stop}>
                  <div className={styles.stopMain}>
                    <input
                      className={styles.stopColor}
                      type="color"
                      value={s.color}
                      title="Stop color"
                      onChange={(e) => editStop(i, { color: e.target.value })}
                    />
                    <NumberInput
                      title="Stop position"
                      value={Math.round(s.offset * 100)}
                      min={0}
                      max={100}
                      onChange={(v) => editStop(i, { offset: Math.min(1, Math.max(0, v / 100)) })}
                    />
                    <span className={styles.pct}>%</span>
                    <IconButton title="Remove stop" disabled={grad.stops.length <= 2} onClick={() => removeStop(i)}>
                      <X size={13} />
                    </IconButton>
                  </div>
                  <div className={styles.stopAlpha}>
                    <span className={styles.alphaLabel} title="Stop opacity (0 = transparent)">
                      Opacity
                    </span>
                    <div
                      className={styles.alphaSlider}
                      style={{
                        '--alpha-track': `linear-gradient(to right, ${withAlpha(s.color, 0)}, ${withAlpha(s.color, 1)})`,
                      }}
                    >
                      <Range value={s.opacity ?? 1} onChange={(v) => editStop(i, { opacity: v })} />
                    </div>
                    <span className={styles.pctValue}>{Math.round((s.opacity ?? 1) * 100)}%</span>
                  </div>
                </div>
              ))}
              <button className={styles.addStop} onClick={addStop}>
                <Plus size={13} /> Add stop
              </button>
            </div>
          </div>
        ) : (
          <Field label="Color">
            <ColorInput value={fill} allowNone onChange={(c) => updateStyle(selection, { fill: c })} />
          </Field>
        )}
      </Group>

      <Group title="Stroke">
        <Field label="Color">
          <ColorInput value={stroke} allowNone onChange={(c) => updateStyle(selection, { stroke: c })} />
        </Field>
        <Field label="Width">
          <NumberInput
            value={strokeWidth}
            min={0}
            step={0.5}
            disabled={!stroke}
            onChange={(v) => updateStyle(selection, { strokeWidth: v })}
          />
        </Field>
        <Field label="Cap">
          <Select
            value={lineCap}
            options={LINE_CAPS}
            disabled={!stroke}
            onChange={(v) => updateStyle(selection, { lineCap: v })}
          />
        </Field>
        <Field label="Join">
          <Select
            value={lineJoin}
            options={LINE_JOINS}
            disabled={!stroke}
            onChange={(v) => updateStyle(selection, { lineJoin: v })}
          />
        </Field>
      </Group>

      <Group title="Opacity">
        <Field label="Opacity">
          <Range value={opacity} onChange={(v) => updateStyle(selection, { opacity: v })} />
          <span className={styles.pctValue}>{Math.round(opacity * 100)}%</span>
        </Field>
      </Group>

      {rectNodes.length > 0 && (
        <Group title="Corner radius">
          <Field label="Radius">
            <NumberInput
              title="Rounded corner radius (0 = sharp corners)"
              value={common(rectNodes, (n) => n.rx || 0)}
              min={0}
              onChange={(v) => updateGeometry(rectNodes.map((n) => n.id), { rx: Math.max(0, v) })}
            />
          </Field>
        </Group>
      )}

      {textNodes.length > 0 && (
        <Group title="Text">
          <Field label="Font">
            <Select
              value={common(textNodes, (n) => n.fontFamily)}
              options={FONT_FAMILIES}
              onChange={(v) => updateText(selection, { fontFamily: v })}
            />
          </Field>
          <Field label="Size">
            <NumberInput
              value={common(textNodes, (n) => n.fontSize)}
              min={1}
              onChange={(v) => updateText(selection, { fontSize: v })}
            />
          </Field>
          <Field label="Weight">
            <Select
              value={common(textNodes, (n) => n.fontWeight)}
              options={FONT_WEIGHTS}
              onChange={(v) => updateText(selection, { fontWeight: v })}
            />
          </Field>
          <Field label="Spacing">
            <NumberInput
              title="Letter spacing"
              value={common(textNodes, (n) => letterSpacingOf(n))}
              step={0.5}
              onChange={(v) => updateText(selection, { letterSpacing: v })}
            />
          </Field>
          <Field label="Width">
            <NumberInput
              title="Character width scale (1 = normal; higher stretches wider)"
              value={common(textNodes, (n) => widthScaleOf(n))}
              min={0.1}
              step={0.05}
              onChange={(v) => updateText(selection, { widthScale: v })}
            />
          </Field>
          <Field label="Line height">
            <NumberInput
              title="Baseline-to-baseline distance, as a multiple of the font size"
              value={common(textNodes, (n) => lineHeightOf(n))}
              min={0}
              step={0.05}
              onChange={(v) => updateText(selection, { lineHeight: v })}
            />
          </Field>
          <Field label="Style">
            <IconRow>
              <IconButton
                title="Italic"
                active={common(textNodes, (n) => n.fontStyle) === 'italic'}
                onClick={() =>
                  updateText(selection, {
                    fontStyle: common(textNodes, (n) => n.fontStyle) === 'italic' ? 'normal' : 'italic',
                  })
                }
              >
                <Italic size={15} />
              </IconButton>
            </IconRow>
          </Field>
          <Field label="Align">
            <IconRow>
              <IconButton title="Left" active={common(textNodes, (n) => n.align) === 'start'} onClick={() => updateText(selection, { align: 'start' })}>
                <AlignLeft size={15} />
              </IconButton>
              <IconButton title="Center" active={common(textNodes, (n) => n.align) === 'middle'} onClick={() => updateText(selection, { align: 'middle' })}>
                <AlignCenter size={15} />
              </IconButton>
              <IconButton title="Right" active={common(textNodes, (n) => n.align) === 'end'} onClick={() => updateText(selection, { align: 'end' })}>
                <AlignRight size={15} />
              </IconButton>
            </IconRow>
          </Field>
          <div className={styles.textActions}>
            <button
              className={styles.actionBtn}
              onClick={toPaths}
              disabled={outlining || !outlinable.length}
              title="Replace the text with its outlines. The result is an editable path — the words are no longer text."
            >
              <Spline size={13} /> {outlining ? 'Converting…' : 'Convert to paths'}
            </button>
          </div>
        </Group>
      )}
    </>
  )
}
