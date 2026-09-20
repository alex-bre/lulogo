import { Fragment, useRef, useState } from 'react'
import {
  Folder,
  FolderOpen,
  Square,
  Circle,
  Minus,
  Hexagon,
  Spline,
  Type,
  Image as ImageIcon,
  Shapes,
  Eye,
  EyeOff,
  Lock,
  LockOpen,
  ChevronRight,
  ChevronDown,
  Group as GroupIcon,
  Ungroup,
  Trash2,
} from 'lucide-react'
import { useStore } from '../../../state/store'
import styles from './LayersTab.module.css'

function TypeIcon({ node, expanded }) {
  switch (node.type) {
    case 'group':
      return expanded ? <FolderOpen size={14} /> : <Folder size={14} />
    case 'rect':
      return <Square size={14} />
    case 'ellipse':
      return <Circle size={14} />
    case 'line':
      return <Minus size={14} />
    case 'polygon':
      return node.name === 'Triangle' ? <Shapes size={14} /> : <Hexagon size={14} />
    case 'path':
      return <Spline size={14} />
    case 'text':
      return <Type size={14} />
    case 'image':
      return <ImageIcon size={14} />
    default:
      return <Shapes size={14} />
  }
}

export default function LayersTab() {
  const doc = useStore((s) => s.document)
  const selection = useStore((s) => s.selection)
  const setSelection = useStore((s) => s.setSelection)
  const toggleSelection = useStore((s) => s.toggleSelection)
  const setNodeHidden = useStore((s) => s.setNodeHidden)
  const setNodeLocked = useStore((s) => s.setNodeLocked)
  const renameNode = useStore((s) => s.renameNode)
  const moveNodes = useStore((s) => s.moveNodes)
  const groupSelection = useStore((s) => s.groupSelection)
  const ungroupSelection = useStore((s) => s.ungroupSelection)
  const removeNodes = useStore((s) => s.removeNodes)

  const [collapsed, setCollapsed] = useState(() => new Set())
  const [editingId, setEditingId] = useState(null)
  const [drop, setDrop] = useState(null) // { id, where }
  const [anchorId, setAnchorId] = useState(null) // pivot row for Shift range-select
  const dragIds = useRef(null) // every row travelling with the current drag

  const toggleCollapse = (id) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const isDescendant = (id, ancestor) => {
    let p = doc.nodes[id] ? doc.nodes[id].parent : null
    while (p) {
      if (p === ancestor) return true
      p = doc.nodes[p] ? doc.nodes[p].parent : null
    }
    return false
  }
  const canDrop = (id) => {
    const dragging = dragIds.current
    if (!dragging || dragging.includes(id)) return false
    return !dragging.some((d) => doc.nodes[d]?.type === 'group' && isDescendant(id, d))
  }

  // The ids of every currently-visible row, in top-to-bottom display order.
  // Mirrors renderRows: each level is reversed and expanded groups recurse.
  const flatVisibleIds = () => {
    const out = []
    const walk = (ids) => {
      for (const id of [...ids].reverse()) {
        const node = doc.nodes[id]
        if (!node) continue
        out.push(id)
        if (node.type === 'group' && !collapsed.has(id)) walk(node.children)
      }
    }
    walk(doc.rootOrder)
    return out
  }

  const onRowClick = (e, id) => {
    if (e.shiftKey) {
      // Range-select every visible row between the pivot and the clicked row.
      const flat = flatVisibleIds()
      const b = flat.indexOf(id)
      let a = anchorId != null ? flat.indexOf(anchorId) : -1
      if (a === -1 && selection.length) a = flat.indexOf(selection[selection.length - 1])
      if (a === -1 || b === -1) {
        setSelection([id])
        setAnchorId(id)
      } else {
        const [lo, hi] = a < b ? [a, b] : [b, a]
        setSelection(flat.slice(lo, hi + 1)) // pivot stays put for further Shift-clicks
      }
    } else if (e.ctrlKey || e.metaKey) {
      toggleSelection(id)
      setAnchorId(id)
    } else {
      setSelection([id])
      setAnchorId(id)
    }
  }

  const onDragOver = (e, node) => {
    if (!canDrop(node.id)) return
    e.preventDefault()
    const r = e.currentTarget.getBoundingClientRect()
    const rel = (e.clientY - r.top) / r.height
    let where
    if (node.type === 'group') where = rel < 0.25 ? 'before' : rel > 0.75 ? 'after' : 'inside'
    else where = rel < 0.5 ? 'before' : 'after'
    setDrop({ id: node.id, where })
  }
  const onDrop = (e, node) => {
    e.preventDefault()
    if (dragIds.current && drop && drop.id === node.id) moveNodes(dragIds.current, node.id, drop.where)
    dragIds.current = null
    setDrop(null)
  }

  const hasGroupSelected = selection.some((id) => doc.nodes[id]?.type === 'group')

  const renderRows = (ids, depth) =>
    [...ids].reverse().map((id) => {
      const node = doc.nodes[id]
      if (!node) return null
      const isGroup = node.type === 'group'
      const expanded = isGroup && !collapsed.has(id)
      const selected = selection.includes(id)
      const dt = drop && drop.id === id ? drop.where : null
      return (
        <Fragment key={id}>
          <div
            className={styles.row}
            data-selected={selected || undefined}
            data-hidden={node.hidden || undefined}
            data-drop={dt || undefined}
            style={{ paddingLeft: 6 + depth * 14 }}
            draggable={editingId !== id}
            onClick={(e) => onRowClick(e, id)}
            onDragStart={(e) => {
              // Grabbing a selected row drags the whole selection; grabbing an
              // unselected one drags just that row and leaves the selection be.
              dragIds.current = selected ? [...selection] : [id]
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('text/plain', id)
            }}
            onDragOver={(e) => onDragOver(e, node)}
            onDrop={(e) => onDrop(e, node)}
            onDragEnd={() => {
              dragIds.current = null
              setDrop(null)
            }}
          >
            {isGroup ? (
              <button
                className={styles.chevron}
                onClick={(e) => {
                  e.stopPropagation()
                  toggleCollapse(id)
                }}
              >
                {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </button>
            ) : (
              <span className={styles.chevron} />
            )}

            <span className={styles.typeIcon}>
              <TypeIcon node={node} expanded={expanded} />
            </span>

            {editingId === id ? (
              <input
                className={styles.rename}
                autoFocus
                defaultValue={node.name}
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => {
                  renameNode(id, e.target.value.trim() || node.name)
                  setEditingId(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.target.blur()
                  else if (e.key === 'Escape') setEditingId(null)
                }}
              />
            ) : (
              <span className={styles.name} onDoubleClick={() => setEditingId(id)}>
                {node.name}
              </span>
            )}

            <button
              className={styles.toggle}
              title={node.hidden ? 'Show' : 'Hide'}
              onClick={(e) => {
                e.stopPropagation()
                setNodeHidden(id, !node.hidden)
              }}
            >
              {node.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
            <button
              className={styles.toggle}
              title={node.locked ? 'Unlock' : 'Lock'}
              onClick={(e) => {
                e.stopPropagation()
                setNodeLocked(id, !node.locked)
              }}
            >
              {node.locked ? <Lock size={14} /> : <LockOpen size={14} />}
            </button>
          </div>
          {isGroup && expanded && renderRows(node.children, depth + 1)}
        </Fragment>
      )
    })

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <button className={styles.tbtn} title="Group (Ctrl+G)" disabled={!selection.length} onClick={groupSelection}>
          <GroupIcon size={15} />
        </button>
        <button
          className={styles.tbtn}
          title="Ungroup (Ctrl+Shift+G)"
          disabled={!hasGroupSelected}
          onClick={ungroupSelection}
        >
          <Ungroup size={15} />
        </button>
        <span className={styles.tspacer} />
        <button
          className={styles.tbtn}
          title="Delete (Del)"
          disabled={!selection.length}
          onClick={() => removeNodes(selection)}
        >
          <Trash2 size={15} />
        </button>
      </div>

      <div className={styles.tree}>
        {doc.rootOrder.length ? (
          renderRows(doc.rootOrder, 0)
        ) : (
          <p className={styles.empty}>No layers yet. Add a shape from the left panel.</p>
        )}
      </div>
    </div>
  )
}
