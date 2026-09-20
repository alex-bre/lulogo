import { useState } from 'react'
import {
  Link2,
  FlipHorizontal2,
  FlipVertical2,
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignCenterHorizontal,
  AlignEndHorizontal,
} from 'lucide-react'
import { useStore } from '../../../state/store'
import { selectedLeafNodes, common } from '../../../state/selectors'
import { selectionBBox } from '../../../model/bbox'
import { Field, Group, NumberInput, IconButton, IconRow } from '../../common/Controls'
import Transform3DSection from './Transform3DSection'
import Move3DSection from './Move3DSection'
import styles from './ArrangeTab.module.css'

export default function ArrangeTab() {
  const doc = useStore((s) => s.document)
  const selection = useStore((s) => s.selection)
  const setSelectionPosition = useStore((s) => s.setSelectionPosition)
  const resizeSelection = useStore((s) => s.resizeSelection)
  const setSelectionRotation = useStore((s) => s.setSelectionRotation)
  const flipSelection = useStore((s) => s.flipSelection)
  const alignSelection = useStore((s) => s.alignSelection)

  const [lock, setLock] = useState(false)
  const [relativeTo, setRelativeTo] = useState('selection')

  const nodes = selectedLeafNodes(doc, selection)
  const box = selectionBBox(doc, selection)
  if (!nodes.length || !box) {
    return <p className={styles.empty}>Select an object to arrange it.</p>
  }

  const rotation = common(nodes, (n) => n.rotation)

  const setW = (w) => {
    if (!box.width) return
    if (lock) resizeSelection(w, box.height * (w / box.width))
    else resizeSelection(w, null)
  }
  const setH = (h) => {
    if (!box.height) return
    if (lock) resizeSelection(box.width * (h / box.height), h)
    else resizeSelection(null, h)
  }

  const alignButtons = [
    { edge: 'left', title: 'Align left', Icon: AlignStartVertical },
    { edge: 'centerH', title: 'Align horizontal centers', Icon: AlignCenterVertical },
    { edge: 'right', title: 'Align right', Icon: AlignEndVertical },
    { edge: 'top', title: 'Align top', Icon: AlignStartHorizontal },
    { edge: 'middle', title: 'Align vertical centers', Icon: AlignCenterHorizontal },
    { edge: 'bottom', title: 'Align bottom', Icon: AlignEndHorizontal },
  ]

  return (
    <>
      <Group
        title="Size"
        right={
          <IconButton title={lock ? 'Unlock aspect ratio' : 'Lock aspect ratio'} active={lock} onClick={() => setLock(!lock)}>
            <Link2 size={14} />
          </IconButton>
        }
      >
        <Field label="Width">
          <NumberInput value={box.width} min={0} onChange={setW} />
        </Field>
        <Field label="Height">
          <NumberInput value={box.height} min={0} onChange={setH} />
        </Field>
      </Group>

      <Group title="Position">
        <Field label="X">
          <NumberInput value={box.x} onChange={(x) => setSelectionPosition(x, box.y)} />
        </Field>
        <Field label="Y">
          <NumberInput value={box.y} onChange={(y) => setSelectionPosition(box.x, y)} />
        </Field>
      </Group>

      <Group title="Rotation">
        <Field label="Angle">
          <NumberInput value={rotation} step={1} onChange={(d) => setSelectionRotation(d)} />
        </Field>
        <Field label="Flip">
          <IconRow>
            <IconButton title="Flip horizontal" onClick={() => flipSelection('h')}>
              <FlipHorizontal2 size={15} />
            </IconButton>
            <IconButton title="Flip vertical" onClick={() => flipSelection('v')}>
              <FlipVertical2 size={15} />
            </IconButton>
          </IconRow>
        </Field>
      </Group>

      <Transform3DSection leaves={nodes} />

      <Move3DSection />

      <Group
        title="Align"
        right={
          <div className={styles.relTo}>
            <button data-active={relativeTo === 'selection' || undefined} onClick={() => setRelativeTo('selection')}>
              Selection
            </button>
            <button data-active={relativeTo === 'page' || undefined} onClick={() => setRelativeTo('page')}>
              Page
            </button>
          </div>
        }
      >
        <IconRow>
          {alignButtons.map(({ edge, title, Icon }) => (
            <IconButton key={edge} title={title} onClick={() => alignSelection(edge, relativeTo)}>
              <Icon size={15} />
            </IconButton>
          ))}
        </IconRow>
      </Group>
    </>
  )
}
