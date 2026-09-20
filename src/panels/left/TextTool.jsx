import { Type } from 'lucide-react'
import { useStore } from '../../state/store'
import { selectedLeafNodes, common } from '../../state/selectors'
import { FONT_FAMILIES } from '../../model/fonts'
import { Select } from '../common/Controls'
import styles from './TextTool.module.css'

export default function TextTool() {
  const tool = useStore((s) => s.ui.tool)
  const setTool = useStore((s) => s.setTool)
  const doc = useStore((s) => s.document)
  const selection = useStore((s) => s.selection)
  const updateText = useStore((s) => s.updateText)
  const defaultFont = useStore((s) => s.ui.defaultFont)
  const setDefaultFont = useStore((s) => s.setDefaultFont)

  const textNodes = selectedLeafNodes(doc, selection).filter((n) => n.type === 'text')
  // Show the selected text's font, or the default that new text will use.
  const family = textNodes.length ? common(textNodes, (n) => n.fontFamily) : defaultFont

  const onFont = (v) => {
    setDefaultFont(v)
    if (textNodes.length) updateText(selection, { fontFamily: v })
  }

  return (
    <div className={styles.wrap}>
      <button
        className={styles.toolBtn}
        data-active={tool === 'text' || undefined}
        onClick={() => setTool(tool === 'text' ? 'select' : 'text')}
      >
        <Type size={15} />
        Text tool
      </button>
      <Select value={family} options={FONT_FAMILIES} onChange={onFont} />
      <p className={styles.hint}>
        {tool === 'text'
          ? 'Click on the canvas to add text (it starts as "Text" — just type to replace it).'
          : 'Pick the tool and click the canvas, or double-click any text to edit it.'}
      </p>
    </div>
  )
}
