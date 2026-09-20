import { createRect, createEllipse, addNode, newObjectStyle } from './nodes'

/**
 * Document model factory. The document is the single serializable source of
 * truth that maps cleanly onto exported SVG.
 *
 * Shape:
 *   page      { width, height }
 *   background null | "#rrggbb"
 *   grid      { size, visible }
 *   snapping  { enabled }          // when on, positions snap to the grid size
 *   defaultStyle { fill, stroke, strokeWidth, opacity }  // for new objects
 *   defs      { gradients: { [id]: gradient } }
 *   nodes     { [id]: Node }      // flat map for O(1) lookups
 *   rootOrder [id, ...]           // top-level z-order, back-to-front
 */
export function createDocument() {
  return {
    page: { width: 1200, height: 1754 },
    background: null,
    grid: { size: 10, visible: true },
    snapping: { enabled: true },
    defaultStyle: newObjectStyle(),
    defs: { gradients: {} },
    nodes: {},
    rootOrder: [],
  }
}

/**
 * The style newly drawn objects start from, with the factory values filling in
 * any gaps — documents saved before the setting existed carry no
 * `defaultStyle`, and they open unchanged because the fallback *is* what those
 * objects used to get.
 */
export function defaultStyleOf(doc) {
  return { ...newObjectStyle(), ...(doc && doc.defaultStyle) }
}

/**
 * A document seeded with a couple of shapes so Phase 1 has something to render.
 * Temporary — removed once placement (Phase 2) lands.
 */
export function createDemoDocument() {
  const doc = createDocument()
  // Objects are ungrouped by default.
  addNode(doc, createRect({ x: 300, y: 320, width: 320, height: 220, rx: 10, style: { fill: '#6c8cff' } }))
  addNode(doc, createEllipse({ cx: 800, cy: 700, rx: 170, ry: 170, style: { fill: '#ff9f6c' } }))
  return doc
}
