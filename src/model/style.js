// Single source of truth for turning a node's style into SVG attributes, with
// SVG defaults omitted so both live rendering and export stay clean.
//
//  - styleEntries: canonical [svgAttrName, value] pairs (kebab) — used by the
//    export serializer.
//  - styleAttrs:   the same, keyed by React prop names (camelCase) — used by
//    the live renderer.

export function styleEntries(style = {}) {
  const e = []

  if (style.fill === null || style.fill === 'none') e.push(['fill', 'none'])
  else if (style.fill != null) e.push(['fill', style.fill])

  if (style.fillOpacity != null && style.fillOpacity !== 1) e.push(['fill-opacity', style.fillOpacity])

  if (style.stroke != null && style.stroke !== 'none') {
    e.push(['stroke', style.stroke])
    if (style.strokeWidth != null && style.strokeWidth !== 1) e.push(['stroke-width', style.strokeWidth])
    if (style.strokeOpacity != null && style.strokeOpacity !== 1) e.push(['stroke-opacity', style.strokeOpacity])
    if (style.lineCap && style.lineCap !== 'butt') e.push(['stroke-linecap', style.lineCap])
    if (style.lineJoin && style.lineJoin !== 'miter') e.push(['stroke-linejoin', style.lineJoin])
    if (style.dash) e.push(['stroke-dasharray', style.dash])
  }

  if (style.opacity != null && style.opacity !== 1) e.push(['opacity', style.opacity])

  return e
}

const SVG_TO_REACT = {
  'fill-opacity': 'fillOpacity',
  'stroke-width': 'strokeWidth',
  'stroke-opacity': 'strokeOpacity',
  'stroke-linecap': 'strokeLinecap',
  'stroke-linejoin': 'strokeLinejoin',
  'stroke-dasharray': 'strokeDasharray',
}

export function styleAttrs(style = {}) {
  const a = {}
  for (const [k, v] of styleEntries(style)) a[SVG_TO_REACT[k] || k] = v
  return a
}
