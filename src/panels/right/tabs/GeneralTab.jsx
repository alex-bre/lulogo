import { Crop } from 'lucide-react'
import { useStore } from '../../../state/store'
import { defaultStyleOf } from '../../../model/document'
import { Field, Group, NumberInput, ColorInput, Toggle, Range } from '../../common/Controls'
import styles from './GeneralTab.module.css'

/** Document-level settings: page size, grid, snapping, background, new-object style. */
export default function GeneralTab() {
  const doc = useStore((s) => s.document)
  const setPageSize = useStore((s) => s.setPageSize)
  const setGrid = useStore((s) => s.setGrid)
  const setSnapping = useStore((s) => s.setSnapping)
  const setBackground = useStore((s) => s.setBackground)
  const setDefaultStyle = useStore((s) => s.setDefaultStyle)
  const fitPageToContent = useStore((s) => s.fitPageToContent)

  const def = defaultStyleOf(doc)

  return (
    <>
      <Group title="Page">
        <Field label="Width">
          <NumberInput value={doc.page.width} min={1} onChange={(v) => setPageSize(v, null)} />
        </Field>
        <Field label="Height">
          <NumberInput value={doc.page.height} min={1} onChange={(v) => setPageSize(null, v)} />
        </Field>
        <button
          className={styles.action}
          disabled={!doc.rootOrder.length}
          title="Resize the page to fit all content, with the top-left object at (0,0)"
          onClick={fitPageToContent}
        >
          <Crop size={14} />
          Resize to content
        </button>
      </Group>

      <Group title="Grid">
        <Field label="Size">
          <NumberInput value={doc.grid.size} min={1} onChange={(v) => setGrid({ size: v })} />
        </Field>
        <Field label="Show">
          <Toggle checked={doc.grid.visible} onChange={(v) => setGrid({ visible: v })} />
        </Field>
      </Group>

      <Group title="Snapping">
        <Field label="Snap to grid">
          <Toggle checked={doc.snapping.enabled} onChange={(v) => setSnapping({ enabled: v })} />
        </Field>
      </Group>

      <Group title="Background">
        <Field label="Color">
          <ColorInput value={doc.background} allowNone onChange={(c) => setBackground(c)} />
        </Field>
      </Group>

      <Group title="Default style">
        <p className={styles.hint}>Applied to objects drawn from here on. Existing objects keep their style.</p>
        <Field label="Fill">
          <ColorInput value={def.fill} allowNone onChange={(c) => setDefaultStyle({ fill: c })} />
        </Field>
        <Field label="Stroke">
          <ColorInput value={def.stroke} allowNone onChange={(c) => setDefaultStyle({ stroke: c })} />
        </Field>
        <Field label="Width">
          <NumberInput
            title="Stroke width for new objects"
            value={def.strokeWidth}
            min={0}
            step={0.5}
            disabled={!def.stroke}
            onChange={(v) => setDefaultStyle({ strokeWidth: v })}
          />
        </Field>
        <Field label="Opacity">
          <Range value={def.opacity} onChange={(v) => setDefaultStyle({ opacity: v })} />
          <span className={styles.pctValue}>{Math.round(def.opacity * 100)}%</span>
        </Field>
      </Group>
    </>
  )
}
