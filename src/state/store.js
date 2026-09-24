import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { createDemoDocument, defaultStyleOf } from '../model/document'
import { migrateDocument } from '../io/migrate'
import { outlinedNode } from '../io/textToPath'
import { addNode, createGroup, createPath, createText, createImage, genId, applyDefaultStyle } from '../model/nodes'
import { createShapeOfKind } from '../model/shapes'
import { parsePath, serializeSubpaths, deleteAnchor } from '../model/pathEdit'
import { roundNodeCorners } from '../model/roundCorners'
import { translateNode, cloneSubtree, scaleNode } from '../model/mutate'
import { snapValue } from '../model/snap'
import { selectionBBox, nodeBounds, nodeCenter, unionBBox, geometryBBox } from '../model/bbox'
import { ANCHOR_FRAC } from '../model/textMetrics'
import { selectionLeaves } from './selectors'
import { rotatePointAbout } from '../model/transform'
import { makeProjector, isIdentityT3D } from '../model/projection3d'
import { sessionBounds, nodeSource, projectSource } from '../model/transform3d'
import { extrudeFaces } from '../model/extrude3d'
import { ensureAnimation, createClip, MIN_CLIP_MS } from '../model/animation'
import { mergeDocumentInto } from '../model/merge'
import { clampZoom, screenToWorld, computeFit } from '../canvas/viewport'

/* ---- tree helpers (operate on an immer draft document) ---- */

// Remove a node id from whatever container currently holds it.
function detach(doc, id) {
  const n = doc.nodes[id]
  const arr = n.parent && doc.nodes[n.parent] ? doc.nodes[n.parent].children : doc.rootOrder
  const i = arr.indexOf(id)
  if (i >= 0) arr.splice(i, 1)
}

// Is `id` inside the subtree rooted at `ancestorId`?
function isDescendant(doc, id, ancestorId) {
  let p = doc.nodes[id] ? doc.nodes[id].parent : null
  while (p) {
    if (p === ancestorId) return true
    p = doc.nodes[p] ? doc.nodes[p].parent : null
  }
  return false
}

// Does any ancestor of `id` sit in `ids`? Keeps a moving subtree whole: a node
// whose ancestor is moving too rides along and must not be moved on its own.
function hasAncestorIn(doc, id, ids) {
  let p = doc.nodes[id] ? doc.nodes[id].parent : null
  while (p) {
    if (ids.has(p)) return true
    p = doc.nodes[p] ? doc.nodes[p].parent : null
  }
  return false
}

// Ids of `wanted` in document paint order (back-to-front), so a block of nodes
// moved together keeps its relative stacking.
function inPaintOrder(doc, wanted) {
  const out = []
  const walk = (list) => {
    for (const id of list) {
      if (wanted.has(id)) out.push(id)
      const n = doc.nodes[id]
      if (n && n.type === 'group') walk(n.children)
    }
  }
  walk(doc.rootOrder)
  return out
}

// Drop animation clips whose node no longer exists (after deletes/booleans).
function pruneClips(doc) {
  if (!doc.animation) return
  doc.animation.clips = doc.animation.clips.filter((c) => doc.nodes[c.nodeId])
}

// Recursively delete a node and its descendants from the document.
function deleteNode(doc, id) {
  const n = doc.nodes[id]
  if (!n) return
  if (n.type === 'group') n.children.slice().forEach((c) => deleteNode(doc, c))
  detach(doc, id)
  delete doc.nodes[id]
}

// Autosave key + initial document load (persisted doc, else the demo).
//
// The `.v1` in the key is inert — nothing has ever read it. The schema version
// now travels inside the stored value instead (see io/migrate), so the key can
// stay put and existing autosaves keep working.
export const STORAGE_KEY = 'lulogo.document.v1'

/** Where an autosave is parked when it cannot be read (see loadInitialDocument). */
export const UNREADABLE_KEY = `${STORAGE_KEY}.unreadable`

/**
 * Where an explicit light/dark choice is remembered. Absent means "not chosen
 * yet", which is what makes the editor follow the OS setting. The pre-paint
 * script in index.html reads this same key — keep the two in step.
 */
export const THEME_KEY = 'lulogo.theme'

/** The OS light/dark preference; 'light' wherever it can't be read. */
export function systemTheme() {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

// Initial theme state: an explicit stored choice, else follow the system.
function initialTheme() {
  let pref = 'system'
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(THEME_KEY)
      if (raw === 'light' || raw === 'dark') pref = raw
    }
  } catch {
    /* storage unavailable — follow the system */
  }
  return { themePref: pref, theme: pref === 'system' ? systemTheme() : pref }
}

/**
 * Read an autosave in either shape: the current `{ version, document }`
 * envelope, or the bare document written before the envelope existed.
 * Returns null if it is neither.
 */
export function readAutosave(raw) {
  const data = JSON.parse(raw)
  if (!data || typeof data !== 'object') return null
  const enveloped = data.document && data.document.nodes
  const doc = enveloped ? data.document : data
  if (!doc.nodes) return null
  return migrateDocument(doc, enveloped ? data.version : undefined)
}

function loadInitialDocument() {
  try {
    if (typeof localStorage === 'undefined') return createDemoDocument()
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return createDemoDocument()

    try {
      const doc = readAutosave(raw)
      if (doc) return doc
      throw new Error('unrecognised autosave shape')
    } catch (err) {
      // Never fall through to the demo document while leaving the old value in
      // place: autosave would overwrite it on the very first edit. A document
      // written by a newer build is readable again after updating the app, but
      // only if it still exists.
      localStorage.setItem(UNREADABLE_KEY, raw)
      localStorage.removeItem(STORAGE_KEY)
      console.warn(
        `Could not load the autosaved document (${err.message}). ` +
          `It has been preserved under "${UNREADABLE_KEY}" rather than overwritten.`,
      )
    }
  } catch {
    /* storage unavailable or full — fall through to the demo document */
  }
  return createDemoDocument()
}

// Internal clipboard: a self-contained snapshot of copied subtrees.
let clipboard = null

// Style clipboard: a single node's `style` object plus, if its fill is a
// gradient, a copy of that gradient def (re-created fresh on each paste).
let styleClipboard = null
const gradIdOf = (fill) => {
  const m = typeof fill === 'string' && fill.match(/^url\(#(.+)\)$/)
  return m ? m[1] : null
}

// Rotate each leaf rigidly about pivot (cx, cy): move its center along the arc
// and add to its own rotation. Drives both the rotate handle and the Angle
// field, for single objects, multi-selections, and groups alike.
function rotateLeaves(doc, leaves, cx, cy, delta) {
  for (const id of leaves) {
    const n = doc.nodes[id]
    if (!n || n.locked) continue
    const c = nodeCenter(n)
    const nc = rotatePointAbout(c, { x: cx, y: cy }, delta)
    translateNode(n, nc.x - c.x, nc.y - c.y, doc.nodes)
    n.rotation = (n.rotation || 0) + delta
  }
}

/**
 * Central app store.
 *  - document  : the artwork model (model/document.js)
 *  - viewport  : pan/zoom of the infinite canvas
 *  - selection : ids of selected top-level nodes
 *  - ui        : editor chrome (theme, active tab/tool, canvas size, marquee)
 */
export const useStore = create(
  immer((set, get) => ({
    document: loadInitialDocument(),

    viewport: { panX: 0, panY: 0, zoom: 1 },

    selection: [],

    // Undo/redo stacks of document snapshots (managed by state/history.js).
    past: [],
    future: [],

    ui: {
      // Theme in two parts: `themePref` is what the user asked for — 'system'
      // until they pick a side — and `theme` is the light/dark actually applied.
      ...initialTheme(),
      leftTab: 'shapes', // shapes | path | text
      rightTab: 'general', // general | style | arrange | layers
      tool: 'select', // select | pen | text | shape
      canvasSize: { width: 0, height: 0 },
      marquee: null, // world-space {x,y,width,height} while box-selecting
      editingTextId: null, // id of the text node currently being edited inline
      defaultFont: 'Inter, sans-serif', // font used for newly created text
      // Bumped once the bundled fonts finish loading, so text re-measures and
      // re-renders against the real faces instead of the startup fallback.
      fontsVersion: 0,
      leftCollapsed: false, // left tool panel collapsed to a rail
      rightCollapsed: false, // right properties panel collapsed to a rail
      svgPreviewOpen: false, // live SVG code preview drawer (collapsed by default)
      editingPathId: null, // id of the path currently in point-edit mode
      activeAnchor: null, // { sp, ai } anchor selected within the edited path
      snapGuides: [], // world-space alignment guides drawn while dragging
      hud: null, // transient move/resize readout: { kind, x, y } | { kind, width, height }
      t3d: null, // 3D-transform preview session: { selKey, ids, params, textD, ... }
      // Animation timeline panel + playback. `previewing` gates whether the
      // canvas renders at the playhead time (true while playing/after a scrub);
      // Stop rewinds and returns the canvas to its design state.
      anim: { open: false, time: 0, playing: false, loop: true, previewing: false, selectedClipId: null },
      hasStyleClip: false, // true once a style has been copied (enables Paste style)
      // Set while an import is waiting to be told whether a file that carries a
      // project should open as one: { name, kind }. See io/importChoice.js.
      importChoice: null,
    },

    /* ---- theme / ui ---- */
    // 'light' | 'dark' is an explicit choice and sticks (state/persist.js writes
    // it to localStorage); 'system' hands control back to the OS setting.
    setTheme: (pref) =>
      set((s) => {
        s.ui.themePref = pref
        s.ui.theme = pref === 'system' ? systemTheme() : pref
      }),
    toggleTheme: () => get().setTheme(get().ui.theme === 'light' ? 'dark' : 'light'),
    // The OS switched sides: follow it, unless a choice has been made here.
    systemThemeChanged: (theme) =>
      set((s) => {
        if (s.ui.themePref === 'system') s.ui.theme = theme
      }),
    setLeftTab: (tab) => set((s) => void (s.ui.leftTab = tab)),
    setRightTab: (tab) => set((s) => void (s.ui.rightTab = tab)),
    setImportChoice: (req) => set((s) => void (s.ui.importChoice = req)),
    toggleLeftPanel: () => set((s) => void (s.ui.leftCollapsed = !s.ui.leftCollapsed)),
    toggleRightPanel: () => set((s) => void (s.ui.rightCollapsed = !s.ui.rightCollapsed)),
    // Explicit setters back the viewport-driven collapse (state/useResponsiveLayout.js).
    setLeftCollapsed: (v) => set((s) => void (s.ui.leftCollapsed = !!v)),
    setRightCollapsed: (v) => set((s) => void (s.ui.rightCollapsed = !!v)),
    toggleSvgPreview: () => set((s) => void (s.ui.svgPreviewOpen = !s.ui.svgPreviewOpen)),

    /* ---- animation timeline ---- */
    toggleAnimPanel: () =>
      set((s) => {
        s.ui.anim.open = !s.ui.anim.open
        if (!s.ui.anim.open) {
          s.ui.anim.playing = false
          s.ui.anim.previewing = false
        }
      }),
    // Scrubbing/seeking shows the scene at that time until Stop is pressed.
    setAnimTime: (t) =>
      set((s) => {
        const dur = s.document.animation ? s.document.animation.duration : 5000
        s.ui.anim.time = Math.max(0, Math.min(dur, t))
        s.ui.anim.previewing = true
      }),
    playAnim: () =>
      set((s) => {
        const dur = s.document.animation ? s.document.animation.duration : 5000
        if (s.ui.anim.time >= dur) s.ui.anim.time = 0
        s.ui.anim.playing = true
        s.ui.anim.previewing = true
      }),
    pauseAnim: () => set((s) => void (s.ui.anim.playing = false)),
    stopAnim: () =>
      set((s) => {
        s.ui.anim.playing = false
        s.ui.anim.previewing = false
        s.ui.anim.time = 0
      }),
    toggleAnimLoop: () => set((s) => void (s.ui.anim.loop = !s.ui.anim.loop)),
    selectClip: (id) => set((s) => void (s.ui.anim.selectedClipId = id)),
    setAnimDuration: (ms) =>
      set((s) => {
        const anim = ensureAnimation(s.document)
        anim.duration = Math.max(500, Math.round(ms))
        s.ui.anim.time = Math.min(s.ui.anim.time, anim.duration)
      }),
    // Add one clip per target node at the playhead; selects the first new clip.
    addEffectClips: (nodeIds, effect) =>
      set((s) => {
        const anim = ensureAnimation(s.document)
        const start = s.ui.anim.time
        let firstId = null
        for (const nodeId of nodeIds) {
          if (!s.document.nodes[nodeId]) continue
          const clip = createClip(nodeId, effect, start, Math.min(1000, Math.max(MIN_CLIP_MS, anim.duration - start)))
          anim.clips.push(clip)
          if (!firstId) firstId = clip.id
        }
        if (firstId) s.ui.anim.selectedClipId = firstId
      }),
    updateClip: (id, partial) =>
      set((s) => {
        const anim = ensureAnimation(s.document)
        const clip = anim.clips.find((c) => c.id === id)
        if (!clip) return
        Object.assign(clip, partial)
        clip.start = Math.max(0, clip.start)
        clip.duration = Math.max(MIN_CLIP_MS, clip.duration)
      }),
    updateClipParams: (id, partial) =>
      set((s) => {
        const anim = ensureAnimation(s.document)
        const clip = anim.clips.find((c) => c.id === id)
        if (clip) Object.assign(clip.params, partial)
      }),
    removeClip: (id) =>
      set((s) => {
        const anim = ensureAnimation(s.document)
        anim.clips = anim.clips.filter((c) => c.id !== id)
        if (s.ui.anim.selectedClipId === id) s.ui.anim.selectedClipId = null
      }),
    // Remove every clip belonging to a node (its whole animation track).
    removeClipsForNode: (nodeId) =>
      set((s) => {
        const anim = ensureAnimation(s.document)
        anim.clips = anim.clips.filter((c) => c.nodeId !== nodeId)
        if (!anim.clips.some((c) => c.id === s.ui.anim.selectedClipId)) s.ui.anim.selectedClipId = null
      }),
    setTool: (tool) =>
      set((s) => {
        s.ui.tool = tool
        // Picking the pen or text tool (e.g. by shortcut) brings up its tab.
        if (tool === 'pen') s.ui.leftTab = 'path'
        if (tool === 'text') s.ui.leftTab = 'text'
        s.ui.editingPathId = null
        s.ui.activeAnchor = null
        s.ui.t3d = null
      }),
    setCanvasSize: (size) => set((s) => void (s.ui.canvasSize = size)),
    setMarquee: (rect) => set((s) => void (s.ui.marquee = rect)),
    // Transient drag feedback (alignment guides + position/size readout).
    setSnapGuides: (guides) => set((s) => void (s.ui.snapGuides = guides)),
    setHud: (hud) => set((s) => void (s.ui.hud = hud)),

    /* ---- path point editing ---- */
    // Enter/leave point-edit mode for a path. Entering also selects it.
    setEditingPath: (id) =>
      set((s) => {
        s.ui.editingPathId = id
        s.ui.activeAnchor = null
        if (id) s.selection = [id]
      }),
    setActiveAnchor: (a) => set((s) => void (s.ui.activeAnchor = a)),
    // Replace a path's geometry directly (drives point/handle drags).
    setPathData: (id, d) =>
      set((s) => {
        const n = s.document.nodes[id]
        if (n && n.type === 'path') n.d = d
      }),
    // Remove anchor (sp, ai) from a path. Deleting the last point removes the
    // whole path node and exits edit mode.
    deletePathPoint: (id, sp, ai) =>
      set((s) => {
        const n = s.document.nodes[id]
        if (!n || n.type !== 'path') return
        const subs = deleteAnchor(parsePath(n.d), sp, ai)
        if (!subs.length) {
          const container =
            n.parent && s.document.nodes[n.parent] ? s.document.nodes[n.parent].children : s.document.rootOrder
          const idx = container.indexOf(id)
          if (idx >= 0) container.splice(idx, 1)
          delete s.document.nodes[id]
          s.selection = s.selection.filter((x) => x !== id)
          s.ui.editingPathId = null
        } else {
          n.d = serializeSubpaths(subs)
        }
        s.ui.activeAnchor = null
      }),

    /* ---- viewport ---- */
    setViewport: (partial) => set((s) => void Object.assign(s.viewport, partial)),
    panBy: (dx, dy) =>
      set((s) => {
        s.viewport.panX += dx
        s.viewport.panY += dy
      }),
    // Zoom by `factor` about screen point (cx, cy), keeping that point fixed.
    zoomAt: (cx, cy, factor) =>
      set((s) => {
        const { panX, panY, zoom } = s.viewport
        const nz = clampZoom(zoom * factor)
        const ratio = nz / zoom
        s.viewport.panX = cx - (cx - panX) * ratio
        s.viewport.panY = cy - (cy - panY) * ratio
        s.viewport.zoom = nz
      }),

    /* ---- selection ---- */
    setSelection: (ids) => set((s) => void (s.selection = Array.isArray(ids) ? ids : [ids])),
    clearSelection: () => set((s) => void (s.selection = [])),
    addToSelection: (id) => set((s) => void (s.selection.includes(id) || s.selection.push(id))),
    toggleSelection: (id) =>
      set((s) => {
        const i = s.selection.indexOf(id)
        if (i >= 0) s.selection.splice(i, 1)
        else s.selection.push(id)
      }),
    selectAll: () => set((s) => void (s.selection = [...s.document.rootOrder])),

    /* ---- node creation ---- */
    addShapeAt: (kind, wx, wy) =>
      set((s) => {
        const cx = snapValue(wx, s.document.snapping, s.document.grid)
        const cy = snapValue(wy, s.document.snapping, s.document.grid)
        const node = createShapeOfKind(kind, cx, cy, defaultStyleOf(s.document))
        // New objects are top-level (ungrouped) by default.
        addNode(s.document, node, null)
        s.selection = [node.id]
      }),
    addShapeAtViewCenter: (kind) => {
      const st = get()
      const { width, height } = st.ui.canvasSize
      const c = screenToWorld(width / 2, height / 2, st.viewport)
      st.addShapeAt(kind, c.x, c.y)
    },

    /* ---- node mutation ---- */
    translateNodes: (ids, dx, dy) =>
      set((s) => {
        for (const id of ids) {
          const n = s.document.nodes[id]
          if (n && !n.locked) translateNode(n, dx, dy, s.document.nodes)
        }
      }),

    removeNodes: (ids) =>
      set((s) => {
        const remove = (id) => {
          const n = s.document.nodes[id]
          if (!n) return
          if (n.type === 'group') n.children.slice().forEach(remove)
          const container =
            n.parent && s.document.nodes[n.parent] ? s.document.nodes[n.parent].children : s.document.rootOrder
          const i = container.indexOf(id)
          if (i >= 0) container.splice(i, 1)
          delete s.document.nodes[id]
        }
        ids.forEach(remove)
        s.selection = s.selection.filter((id) => s.document.nodes[id])
        pruneClips(s.document)
      }),

    duplicateNodes: (ids) =>
      set((s) => {
        const created = []
        for (const id of ids) {
          const node = s.document.nodes[id]
          if (!node) continue
          const grads = s.document.defs.gradients
          const copy = cloneSubtree(node, s.document.nodes, s.document.nodes, grads, grads)
          translateNode(copy, 10, 10, s.document.nodes)
          copy.parent = node.parent
          const container =
            node.parent && s.document.nodes[node.parent]
              ? s.document.nodes[node.parent].children
              : s.document.rootOrder
          container.splice(container.indexOf(id) + 1, 0, copy.id)
          created.push(copy.id)
        }
        if (created.length) s.selection = created
      }),

    /* ---- document settings (General tab) ---- */
    setPageSize: (width, height) =>
      set((s) => {
        if (width > 0) s.document.page.width = width
        if (height > 0) s.document.page.height = height
      }),
    // Resize the page to fit all content: shift everything so the top-left of
    // the scene's bounding box lands on (0,0), then size the page to it.
    fitPageToContent: () =>
      set((s) => {
        const ids = s.document.rootOrder
        const box = unionBBox(
          ids.filter((id) => s.document.nodes[id] && !s.document.nodes[id].hidden).map((id) => nodeBounds(s.document.nodes[id], s.document.nodes)),
        )
        if (!box || (box.width <= 0 && box.height <= 0)) return
        if (box.x !== 0 || box.y !== 0) {
          for (const id of ids) {
            const n = s.document.nodes[id]
            if (n) translateNode(n, -box.x, -box.y, s.document.nodes)
          }
        }
        s.document.page.width = Math.max(1, Math.ceil(box.width))
        s.document.page.height = Math.max(1, Math.ceil(box.height))
        const { width, height } = s.ui.canvasSize
        if (width && height) {
          Object.assign(s.viewport, computeFit(width, height, s.document.page.width, s.document.page.height))
        }
      }),

    setGrid: (partial) => set((s) => void Object.assign(s.document.grid, partial)),
    setSnapping: (partial) => set((s) => void Object.assign(s.document.snapping, partial)),
    setBackground: (color) => set((s) => void (s.document.background = color)),
    // The style newly drawn objects start from. Assigning the merged object
    // (rather than Object.assign) also fills the setting in on documents saved
    // before it existed.
    setDefaultStyle: (partial) =>
      set((s) => void (s.document.defaultStyle = { ...defaultStyleOf(s.document), ...partial })),

    /* ---- style (Style tab) ---- */
    updateStyle: (ids, partial) =>
      set((s) => {
        for (const id of selectionLeaves(s.document, ids)) {
          const n = s.document.nodes[id]
          if (n) Object.assign(n.style, partial)
        }
      }),
    // Assign top-level (non-style) node fields — e.g. a rect's corner radius.
    // Caller passes the ids the fields make sense for; a single commit is one
    // undo step, so discrete panel controls need no history batching.
    updateGeometry: (ids, partial) =>
      set((s) => {
        for (const id of selectionLeaves(s.document, ids)) {
          const n = s.document.nodes[id]
          if (n) Object.assign(n, partial)
        }
      }),
    // Round the sharp corners of every roundable leaf in the selection. A rect
    // just gets an `rx` (still live and editable); a polygon or path is baked
    // into new path data, so this is a one-shot edit, not a property.
    roundCorners: (ids, radius) => {
      const st = get()
      const updates = []
      for (const id of selectionLeaves(st.document, ids)) {
        const next = roundNodeCorners(st.document.nodes[id], radius)
        if (next) updates.push([id, next])
      }
      // Nothing to round: leave the document identity alone so history records
      // no step (state/history.js pushes on any new document object).
      if (!updates.length) return
      set((s) => {
        for (const [id, next] of updates) s.document.nodes[id] = next
      })
    },

    upsertGradient: (grad) => set((s) => void (s.document.defs.gradients[grad.id] = grad)),
    removeGradient: (id) => set((s) => void delete s.document.defs.gradients[id]),

    // Copy the style of the first selected leaf (fill/stroke/opacity/etc.),
    // capturing its gradient def if the fill is a gradient.
    copyStyle: () => {
      const st = get()
      const id = selectionLeaves(st.document, st.selection)[0]
      const n = id && st.document.nodes[id]
      if (!n) return
      const style = JSON.parse(JSON.stringify(n.style || {}))
      const gid = gradIdOf(style.fill)
      const gradient =
        gid && st.document.defs.gradients[gid] ? JSON.parse(JSON.stringify(st.document.defs.gradients[gid])) : null
      styleClipboard = { style, gradient }
      set((s) => void (s.ui.hasStyleClip = true))
    },
    // Apply the copied style to the given selection. A copied gradient is
    // re-created under a fresh id so pasted objects don't share/mutate it.
    pasteStyle: (ids) =>
      set((s) => {
        if (!styleClipboard) return
        const targets = selectionLeaves(s.document, ids)
        if (!targets.length) return
        let fill = styleClipboard.style.fill
        if (styleClipboard.gradient) {
          const newId = genId('grad')
          s.document.defs.gradients[newId] = { ...JSON.parse(JSON.stringify(styleClipboard.gradient)), id: newId }
          fill = `url(#${newId})`
        }
        const style = { ...styleClipboard.style, fill }
        for (const id of targets) {
          const n = s.document.nodes[id]
          if (n && !n.locked) Object.assign(n.style, style)
        }
      }),

    /* ---- arrange (Arrange tab + handles) ---- */
    setSelectionPosition: (x, y) =>
      set((s) => {
        const box = selectionBBox(s.document, s.selection)
        if (!box) return
        const dx = (x ?? box.x) - box.x
        const dy = (y ?? box.y) - box.y
        for (const id of s.selection) {
          const n = s.document.nodes[id]
          if (n && !n.locked) translateNode(n, dx, dy, s.document.nodes)
        }
      }),

    // Resize the selection bbox to a target size, anchored at its top-left.
    resizeSelection: (width, height) =>
      set((s) => {
        const box = selectionBBox(s.document, s.selection)
        if (!box) return
        const sx = width != null && box.width ? width / box.width : 1
        const sy = height != null && box.height ? height / box.height : 1
        for (const id of s.selection) {
          const n = s.document.nodes[id]
          if (n && !n.locked) scaleNode(n, box.x, box.y, sx, sy, s.document.nodes)
        }
      }),

    // Incremental scale about an arbitrary anchor (used by resize handles).
    scaleSelectionBy: (ox, oy, sx, sy) =>
      set((s) => {
        for (const id of s.selection) {
          const n = s.document.nodes[id]
          if (n && !n.locked) scaleNode(n, ox, oy, sx, sy, s.document.nodes)
        }
      }),

    // Rotate the whole selection (single / multi / group) to an absolute angle,
    // rigidly about its center. When the parts share an angle that's the
    // reference; otherwise rotate from 0.
    setSelectionRotation: (deg) =>
      set((s) => {
        const leaves = selectionLeaves(s.document, s.selection)
        const box = selectionBBox(s.document, s.selection)
        if (!leaves.length || !box) return
        let ref = s.document.nodes[leaves[0]].rotation || 0
        for (const id of leaves) {
          if ((s.document.nodes[id].rotation || 0) !== ref) {
            ref = 0
            break
          }
        }
        rotateLeaves(s.document, leaves, box.x + box.width / 2, box.y + box.height / 2, deg - ref)
      }),

    // Incremental rotation of the selection about a pivot (used by the handle).
    rotateSelectionBy: (cx, cy, delta) =>
      set((s) => {
        rotateLeaves(s.document, selectionLeaves(s.document, s.selection), cx, cy, delta)
      }),

    // Mirror the selection about its center on the given axis ('h' | 'v').
    flipSelection: (axis) =>
      set((s) => {
        const box = selectionBBox(s.document, s.selection)
        if (!box) return
        const cx = box.x + box.width / 2
        const cy = box.y + box.height / 2
        for (const id of selectionLeaves(s.document, s.selection)) {
          const n = s.document.nodes[id]
          if (!n || n.locked) continue
          const c = nodeCenter(n)
          if (axis === 'h') {
            translateNode(n, 2 * cx - 2 * c.x, 0, s.document.nodes)
            n.flipX = !n.flipX
          } else {
            translateNode(n, 0, 2 * cy - 2 * c.y, s.document.nodes)
            n.flipY = !n.flipY
          }
        }
      }),

    // Align each selected node's bbox to an edge of the selection or the page.
    alignSelection: (edge, relativeTo = 'selection') =>
      set((s) => {
        if (!s.selection.length) return
        const target =
          relativeTo === 'page'
            ? { x: 0, y: 0, width: s.document.page.width, height: s.document.page.height }
            : selectionBBox(s.document, s.selection)
        if (!target) return
        for (const id of s.selection) {
          const n = s.document.nodes[id]
          if (!n || n.locked) continue
          const b = nodeBounds(n, s.document.nodes)
          if (!b) continue
          let dx = 0
          let dy = 0
          if (edge === 'left') dx = target.x - b.x
          else if (edge === 'right') dx = target.x + target.width - (b.x + b.width)
          else if (edge === 'centerH') dx = target.x + target.width / 2 - (b.x + b.width / 2)
          else if (edge === 'top') dy = target.y - b.y
          else if (edge === 'bottom') dy = target.y + target.height - (b.y + b.height)
          else if (edge === 'middle') dy = target.y + target.height / 2 - (b.y + b.height / 2)
          if (dx || dy) translateNode(n, dx, dy, s.document.nodes)
        }
      }),

    /* ---- 3D transform (Arrange tab: live preview + destructive apply) ---- */
    // The preview session lives in ui only — the document is untouched until
    // Apply, so cancelling is free and Apply is a single undo step.
    startT3D: (session) => set((s) => void (s.ui.t3d = session)),
    setT3DParams: (partial) =>
      set((s) => {
        if (s.ui.t3d) Object.assign(s.ui.t3d.params, partial)
      }),
    cancelT3D: () => set((s) => void (s.ui.t3d = null)),
    // Bake the previewed projection into the session's nodes: shapes/text
    // become paths, polygons stay polygons, lines stay lines (straight lines
    // are exact under both projections). With thickness (depth > 0) each node
    // instead becomes a GROUP of shaded faces forming a solid block. Rotation/
    // flip are consumed by the bake and reset; one undo step either way.
    applyT3D: () =>
      set((s) => {
        const t = s.ui.t3d
        if (!t) return
        const { ids, textD } = t
        const params = { ...t.params }
        s.ui.t3d = null
        const depth = params.depth || 0
        if (isIdentityT3D(params) && !(depth > 0)) return // nothing to bake — no history noise
        const box = sessionBounds(s.document, ids)
        if (!box) return
        const projector = makeProjector(params, box)
        const newGroups = []
        for (const id of ids) {
          const n = s.document.nodes[id]
          if (!n || n.locked) continue
          const src = nodeSource(n, textD)
          if (!src) continue

          // Images can't become paths — they bake to an image carrying the
          // projected affine matrix (thickness doesn't apply). Null patch means
          // perspective, where images stay flat, so leave the node untouched.
          if (n.type === 'image') {
            const patch = projectSource(src, projector)
            if (!patch) continue
            s.document.nodes[id] = {
              id: n.id,
              type: 'image',
              name: n.name,
              parent: n.parent,
              rotation: 0,
              flipX: false,
              flipY: false,
              locked: n.locked,
              hidden: n.hidden,
              style: { ...n.style },
              x: patch.geom.x,
              y: patch.geom.y,
              width: patch.geom.width,
              height: patch.geom.height,
              href: patch.geom.href,
              matrix: patch.geom.matrix,
            }
            continue
          }

          if (depth > 0) {
            const faces = extrudeFaces(src, projector, depth, n.style, { flat: params.flatShade, simple: params.simple, taper: params.taper })
            if (!faces.length) continue
            const parentId = n.parent || null
            const container =
              parentId && s.document.nodes[parentId] ? s.document.nodes[parentId].children : s.document.rootOrder
            const at = container.indexOf(id)
            const group = createGroup({ name: `${n.name} (3D)` })
            group.parent = parentId
            const childIds = []
            for (const f of faces) {
              // Faces come back-to-front, matching child paint order. The front
              // cap keeps the object's own style; walls/back carry the shaded
              // fill (a matching hairline stroke closes anti-alias seams).
              const style =
                f.role === 'front'
                  ? { ...n.style }
                  : { fill: f.fill, stroke: f.fill, strokeWidth: 1, opacity: n.style?.opacity ?? 1 }
              const p = createPath({ d: f.d, style })
              p.parent = group.id
              s.document.nodes[p.id] = p
              childIds.push(p.id)
            }
            group.children = childIds
            s.document.nodes[group.id] = group
            delete s.document.nodes[id]
            container.splice(at < 0 ? container.length : at, at < 0 ? 0 : 1, group.id)
            newGroups.push(group.id)
            continue
          }

          const patch = projectSource(src, projector)
          if (!patch) continue
          s.document.nodes[id] = {
            id: n.id,
            type: patch.type,
            name: n.name,
            parent: n.parent,
            rotation: 0,
            flipX: false,
            flipY: false,
            locked: n.locked,
            hidden: n.hidden,
            style: { ...n.style },
            ...patch.geom,
          }
        }
        if (newGroups.length) s.selection = newGroups
      }),

    // Replace a node's full object (used by rotated-object resize, which
    // recomputes geometry from a drag-start snapshot each move).
    replaceNode: (id, node) =>
      set((s) => {
        if (s.document.nodes[id]) s.document.nodes[id] = node
      }),

    setLineEndpoint: (id, which, x, y) =>
      set((s) => {
        const n = s.document.nodes[id]
        if (!n || n.type !== 'line') return
        if (which === 1) {
          n.x1 = x
          n.y1 = y
        } else {
          n.x2 = x
          n.y2 = y
        }
      }),

    /* ---- layers (Layers tab) ---- */
    // Hide/lock every node in `ids` (one undo step).
    setNodesHidden: (ids, hidden) =>
      set((s) => {
        for (const id of ids) if (s.document.nodes[id]) s.document.nodes[id].hidden = hidden
      }),
    setNodesLocked: (ids, locked) =>
      set((s) => {
        for (const id of ids) if (s.document.nodes[id]) s.document.nodes[id].locked = locked
      }),
    renameNode: (id, name) => set((s) => void (s.document.nodes[id] && (s.document.nodes[id].name = name))),

    // Move every node in `ids` relative to `targetId`. `where`: 'before' |
    // 'after' (siblings, in panel/visual order) or 'inside' (into a target
    // group, front-most). The moved nodes land as one contiguous block and keep
    // their relative stacking, so dragging a multi-selection reads the same as
    // dragging a single row.
    moveNodes: (ids, targetId, where) =>
      set((s) => {
        const doc = s.document
        const target = doc.nodes[targetId]
        if (!target) return
        const wanted = new Set(ids.filter((id) => doc.nodes[id]))
        // Skip the target itself, anything already riding along inside another
        // moving node, and any group that would swallow the target.
        const moving = new Set(
          [...wanted].filter(
            (id) => id !== targetId && !hasAncestorIn(doc, id, wanted) && !isDescendant(doc, targetId, id),
          ),
        )
        const ordered = inPaintOrder(doc, moving)
        if (!ordered.length) return

        for (const id of ordered) detach(doc, id)
        if (where === 'inside' && target.type === 'group') {
          for (const id of ordered) doc.nodes[id].parent = targetId
          target.children.push(...ordered)
          return
        }
        const parentId = target.parent
        const arr = parentId && doc.nodes[parentId] ? doc.nodes[parentId].children : doc.rootOrder
        for (const id of ordered) doc.nodes[id].parent = parentId || null
        const i = arr.indexOf(targetId)
        // Panel shows front-at-top, so visual "before" == higher z == index+1.
        arr.splice(where === 'before' ? i + 1 : i, 0, ...ordered)
      }),

    moveNode: (dragId, targetId, where) => get().moveNodes([dragId], targetId, where),

    // Reorder selected nodes within their own sibling list (z-order). `where`:
    // 'front' | 'back' | 'forward' | 'backward'. Front-most = end of the array
    // (painted last). Nodes keep their parent; each container is handled on its
    // own so a multi-selection spanning groups stays sane.
    reorderNodes: (ids, where) =>
      set((s) => {
        const doc = s.document
        const valid = ids.filter((id) => doc.nodes[id])
        if (!valid.length) return
        const byParent = new Map() // parentId | '__root__' -> child-array ref
        for (const id of valid) {
          const key = doc.nodes[id].parent || '__root__'
          if (!byParent.has(key)) {
            const pid = doc.nodes[id].parent
            byParent.set(key, pid && doc.nodes[pid] ? doc.nodes[pid].children : doc.rootOrder)
          }
        }
        for (const [key, arr] of byParent) {
          const members = new Set(valid.filter((id) => (doc.nodes[id].parent || '__root__') === key))
          const ordered = arr.filter((id) => members.has(id)) // preserve relative order
          if (where === 'front' || where === 'back') {
            for (let i = arr.length - 1; i >= 0; i--) if (members.has(arr[i])) arr.splice(i, 1)
            if (where === 'front') arr.push(...ordered)
            else arr.unshift(...ordered)
          } else if (where === 'forward') {
            for (let i = arr.length - 2; i >= 0; i--) {
              if (members.has(arr[i]) && !members.has(arr[i + 1])) {
                const t = arr[i]
                arr[i] = arr[i + 1]
                arr[i + 1] = t
              }
            }
          } else if (where === 'backward') {
            for (let i = 1; i < arr.length; i++) {
              if (members.has(arr[i]) && !members.has(arr[i - 1])) {
                const t = arr[i]
                arr[i] = arr[i - 1]
                arr[i - 1] = t
              }
            }
          }
        }
      }),

    groupSelection: () =>
      set((s) => {
        const doc = s.document
        const selected = new Set(s.selection.filter((id) => doc.nodes[id]))
        if (selected.size < 1) return
        // Collect the selected ids in document paint order (back-to-front) so
        // the group's child order preserves the layers' original stacking.
        const ids = inPaintOrder(doc, selected)
        const parentId = doc.nodes[ids[0]].parent
        const siblings = parentId && doc.nodes[parentId] ? doc.nodes[parentId].children : doc.rootOrder
        // The group inherits the z-position of its front-most member instead of
        // jumping to the front of the container. Remember the sibling directly
        // above that member — it survives the detach below, so re-finding it
        // afterwards gives the insertion point.
        let top = -1
        for (let i = 0; i < siblings.length; i++) if (selected.has(siblings[i])) top = i
        const above = siblings[top + 1] // undefined when a member was front-most

        const group = createGroup({ name: 'Group' })
        group.parent = parentId || null
        doc.nodes[group.id] = group
        for (const id of ids) {
          detach(doc, id)
          doc.nodes[id].parent = group.id
          group.children.push(id)
        }
        const container = parentId && doc.nodes[parentId] ? doc.nodes[parentId].children : doc.rootOrder
        const at = above === undefined ? -1 : container.indexOf(above)
        container.splice(at < 0 ? container.length : at, 0, group.id)
        s.selection = [group.id]
      }),

    ungroupSelection: () =>
      set((s) => {
        const next = []
        for (const id of [...s.selection]) {
          const g = s.document.nodes[id]
          if (!g || g.type !== 'group') {
            next.push(id)
            continue
          }
          const parentId = g.parent
          const container = parentId && s.document.nodes[parentId] ? s.document.nodes[parentId].children : s.document.rootOrder
          const at = container.indexOf(id)
          const kids = [...g.children]
          container.splice(at, 1, ...kids)
          for (const cid of kids) s.document.nodes[cid].parent = parentId || null
          delete s.document.nodes[id]
          next.push(...kids)
        }
        s.selection = next
        pruneClips(s.document)
      }),

    /* ---- text tool (Phase 6) ---- */
    // Create a text node at (wx, wy) and enter inline editing. Returns its id.
    addTextAt: (wx, wy) => {
      const st = get()
      const x = snapValue(wx, st.document.snapping, st.document.grid)
      const y = snapValue(wy, st.document.snapping, st.document.grid)
      // Seed with visible placeholder content (the editor selects it) so a new
      // text node is obviously there even before typing.
      const node = applyDefaultStyle(
        createText({ x, y, text: 'Text', fontFamily: st.ui.defaultFont }),
        defaultStyleOf(st.document),
      )
      set((s) => {
        addNode(s.document, node, null)
        s.selection = [node.id]
        s.ui.editingTextId = node.id
      })
      return node.id
    },
    setDefaultFont: (font) => set((s) => void (s.ui.defaultFont = font)),
    fontsLoaded: () => set((s) => void (s.ui.fontsVersion += 1)),
    setTextContent: (id, text) =>
      set((s) => {
        const n = s.document.nodes[id]
        if (n && n.type === 'text') n.text = text
      }),
    setEditingText: (id) => set((s) => void (s.ui.editingTextId = id)),
    // Update top-level text props (fontFamily, fontSize, fontWeight, ...).
    // `x` is the anchor point, and which edge of the text it pins depends on
    // `align`; so when the alignment changes we move the anchor to keep the text
    // block visually where it was (otherwise it would jump sideways).
    updateText: (ids, partial) =>
      set((s) => {
        for (const id of selectionLeaves(s.document, ids)) {
          const n = s.document.nodes[id]
          if (!n || n.type !== 'text') continue
          const realign = partial.align != null && partial.align !== n.align
          const left = realign ? geometryBBox(n).x : 0
          Object.assign(n, partial)
          // ANCHOR_FRAC: start pins the left edge, middle the center, end the
          // right. Use the rendered box width (widthScale baked in).
          if (realign) n.x = left + ANCHOR_FRAC[n.align] * geometryBBox(n).width
        }
      }),

    // Replace text nodes with their outlines, in the document — the destructive
    // counterpart of the "text to paths" export option. `outlines` maps node id
    // to path data; the caller produces it with io/textToPath's outlineTextNodes
    // because outlining is async (opentype has to fetch and parse the font file)
    // while store actions are synchronous — the same split as the 3D bake. Ids
    // that are no longer text, or are locked, are ignored; one undo step.
    applyTextToPaths: (outlines) =>
      set((s) => {
        let converted = false
        for (const [id, d] of Object.entries(outlines)) {
          const n = s.document.nodes[id]
          if (!n || n.type !== 'text' || n.locked) continue
          s.document.nodes[id] = outlinedNode(n, d)
          converted = true
        }
        // Nothing changed: leave the document object alone so no undo step is
        // recorded (state/history.js pushes on any new document identity).
        if (!converted) return
        if (outlines[s.ui.editingTextId]) s.ui.editingTextId = null
      }),

    // Replace the whole document (opening an editable project file) and fit it
    // into view.
    loadDocument: (doc) =>
      set((s) => {
        s.document = doc
        s.selection = []
        s.ui.editingTextId = null
        s.ui.editingPathId = null
        s.ui.activeAnchor = null
        s.ui.marquee = null
        const { width, height } = s.ui.canvasSize
        if (width && height) {
          Object.assign(s.viewport, computeFit(width, height, doc.page.width, doc.page.height))
        }
      }),

    // Add another project's artwork on top of this one, where it was drawn,
    // keeping this document's settings (model/merge.js). The additions come in
    // selected, so they can be moved or deleted as a unit straight away.
    mergeDocument: (source) =>
      set((s) => {
        const created = mergeDocumentInto(s.document, source)
        if (!created.length) return
        s.selection = created
        s.ui.editingTextId = null
        s.ui.editingPathId = null
        s.ui.activeAnchor = null
      }),

    /* ---- import (Phase 7) ---- */
    // Add already-built nodes (e.g. from an SVG import). Multiple nodes are
    // wrapped in a group named after the source; a single node goes top-level.
    addImportedNodes: (nodes, groupName, gradients) =>
      set((s) => {
        if (!nodes || !nodes.length) return
        if (gradients) Object.assign(s.document.defs.gradients, gradients)
        if (nodes.length === 1) {
          const n = nodes[0]
          n.parent = null
          s.document.nodes[n.id] = n
          s.document.rootOrder.push(n.id)
          s.selection = [n.id]
          return
        }
        const g = createGroup({ name: groupName || 'Imported' })
        s.document.nodes[g.id] = g
        for (const n of nodes) {
          n.parent = g.id
          s.document.nodes[n.id] = n
          g.children.push(n.id)
        }
        s.document.rootOrder.push(g.id)
        s.selection = [g.id]
      }),

    /* ---- clipboard (Phase 8) ---- */
    copySelection: () => {
      const st = get()
      const nodes = {}
      const collect = (id) => {
        const n = st.document.nodes[id]
        if (!n) return
        nodes[id] = JSON.parse(JSON.stringify(n))
        if (n.type === 'group') n.children.forEach(collect)
      }
      st.selection.forEach(collect)
      const gradients = JSON.parse(JSON.stringify(st.document.defs.gradients))
      clipboard = { roots: st.selection.filter((id) => st.document.nodes[id]), nodes, gradients }
    },
    cutSelection: () => {
      get().copySelection()
      get().removeNodes(get().selection)
    },
    pasteClipboard: () =>
      set((s) => {
        if (!clipboard || !clipboard.roots.length) return
        const created = []
        for (const rootId of clipboard.roots) {
          const root = clipboard.nodes[rootId]
          if (!root) continue
          const copy = cloneSubtree(
            root,
            clipboard.nodes,
            s.document.nodes,
            clipboard.gradients,
            s.document.defs.gradients,
          )
          translateNode(copy, 12, 12, s.document.nodes)
          copy.parent = null
          s.document.rootOrder.push(copy.id)
          created.push(copy.id)
        }
        if (created.length) s.selection = created
      }),

    // Place an embedded raster image at its native pixel size, centered on
    // (wx, wy). (Resize afterwards with the selection handles if needed.)
    addImageAt: (href, width, height, wx, wy) =>
      set((s) => {
        const w = width || 200
        const h = height || 200
        const x = snapValue(wx - w / 2, s.document.snapping, s.document.grid)
        const y = snapValue(wy - h / 2, s.document.snapping, s.document.grid)
        const node = applyDefaultStyle(createImage({ x, y, width: w, height: h, href }), defaultStyleOf(s.document))
        addNode(s.document, node, null)
        s.selection = [node.id]
      }),

    /* ---- path tool + booleans (Phase 5) ---- */
    addPath: (d, closed) =>
      set((s) => {
        const defaults = defaultStyleOf(s.document)
        // An open path is only visible as a stroke, so it always gets one: the
        // document default when it defines a stroke, else the standard ink line.
        const style = closed
          ? defaults
          : {
              ...defaults,
              fill: null,
              stroke: defaults.stroke || '#1a1d21',
              strokeWidth: defaults.stroke ? defaults.strokeWidth : 2,
            }
        const node = createPath({ d, style })
        addNode(s.document, node, null)
        s.selection = [node.id]
      }),

    // Apply a plan from geometry/boolean.js: remove the operands, insert the
    // resulting path (or, for an image intersect, image) where the bottom-most
    // operand was.
    applyBoolean: (result) =>
      set((s) => {
        if (!result) return

        // Group-distribute plan: each member of the base group is replaced by
        // its cut result (in place, keeping its style + z-order); empty results
        // and the cutter operands are removed; the group is preserved.
        if (result.kind === 'group-distribute') {
          const doc = s.document
          for (const { id, d, style } of result.replace) {
            const old = doc.nodes[id]
            if (!old) continue
            const parentId = old.parent
            const container = parentId && doc.nodes[parentId] ? doc.nodes[parentId].children : doc.rootOrder
            const at = container.indexOf(id)
            deleteNode(doc, id)
            if (!d) continue // fully consumed → member removed
            const node = createPath({ d, style })
            node.parent = parentId || null
            doc.nodes[node.id] = node
            const cont = parentId && doc.nodes[parentId] ? doc.nodes[parentId].children : doc.rootOrder
            cont.splice(at < 0 ? cont.length : Math.min(at, cont.length), 0, node.id)
          }
          for (const id of result.removeIds) deleteNode(doc, id)
          const g = doc.nodes[result.groupId]
          if (g && g.type === 'group' && g.children.length === 0) {
            deleteNode(doc, result.groupId)
            s.selection = []
          } else {
            s.selection = [result.groupId]
          }
          pruneClips(doc)
          return
        }

        const base = s.document.nodes[result.baseId]
        const parentId = base ? base.parent : null
        const container =
          parentId && s.document.nodes[parentId] ? s.document.nodes[parentId].children : s.document.rootOrder
        const at = container.indexOf(result.baseId)
        for (const id of result.removeIds) deleteNode(s.document, id)
        // Image ∩ shape(s): the plan carries a pre-rendered PNG the size of the
        // intersection; drop in a plain image where the source image sat.
        const node =
          result.kind === 'image-intersect'
            ? createImage({ ...result.image })
            : createPath({ d: result.d, style: result.style })
        node.parent = parentId || null
        s.document.nodes[node.id] = node
        const cont =
          parentId && s.document.nodes[parentId] ? s.document.nodes[parentId].children : s.document.rootOrder
        cont.splice(at < 0 ? cont.length : Math.min(at, cont.length), 0, node.id)
        s.selection = [node.id]
        pruneClips(s.document)
      }),
  })),
)
