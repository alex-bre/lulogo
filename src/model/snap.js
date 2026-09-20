// Snapping + rectangle intersection helpers.

/**
 * Snap a single page-coordinate value to the grid. When snapping is enabled,
 * values round to the grid size; otherwise the value is returned untouched.
 */
export function snapValue(v, snapping, grid) {
  if (snapping && snapping.enabled && grid && grid.size) {
    return Math.round(v / grid.size) * grid.size
  }
  return v
}

/** Axis-aligned rectangle overlap test. */
export function rectsIntersect(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}
