// Pure viewport math shared by the store, canvas, and zoom controls.
// The canvas renders content inside `translate(panX, panY) scale(zoom)`, so a
// world point (wx, wy) maps to screen (wx*zoom + panX, wy*zoom + panY), all
// relative to the SVG element's top-left corner.

export const MIN_ZOOM = 0.02
export const MAX_ZOOM = 64

export const clampZoom = (z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))

export function screenToWorld(sx, sy, vp) {
  return { x: (sx - vp.panX) / vp.zoom, y: (sy - vp.panY) / vp.zoom }
}

export function worldToScreen(wx, wy, vp) {
  return { x: wx * vp.zoom + vp.panX, y: wy * vp.zoom + vp.panY }
}

/** Compute a viewport that centers a page of (pw x ph) inside (cw x ch). */
export function computeFit(cw, ch, pw, ph, margin = 0.9) {
  if (!cw || !ch || !pw || !ph) return { panX: 0, panY: 0, zoom: 1 }
  const zoom = clampZoom(Math.min(cw / pw, ch / ph) * margin)
  return {
    zoom,
    panX: (cw - pw * zoom) / 2,
    panY: (ch - ph * zoom) / 2,
  }
}
