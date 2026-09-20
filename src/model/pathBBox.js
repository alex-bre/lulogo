// Exact path bounds via a hidden SVG element's getBBox(), cached by the `d`
// string (cheap during re-renders; only new path data triggers a layout read).
// Falls back to a control-point bounds estimate when no real layout engine is
// available (e.g. jsdom in tests).

const SVG_NS = 'http://www.w3.org/2000/svg'
let svgEl = null
let pathEl = null

function ensureEl() {
  if (svgEl) return
  svgEl = document.createElementNS(SVG_NS, 'svg')
  svgEl.setAttribute('width', '0')
  svgEl.setAttribute('height', '0')
  svgEl.style.position = 'absolute'
  svgEl.style.left = '-99999px'
  svgEl.style.top = '0'
  svgEl.style.visibility = 'hidden'
  pathEl = document.createElementNS(SVG_NS, 'path')
  svgEl.appendChild(pathEl)
  document.body.appendChild(svgEl)
}

function fallbackBBox(d) {
  const nums = (d.match(/-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) || []).map(Number)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const x = nums[i]
    const y = nums[i + 1]
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  if (minX === Infinity) return { x: 0, y: 0, width: 0, height: 0 }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

const cache = new Map()

export function pathBBox(d) {
  if (!d) return { x: 0, y: 0, width: 0, height: 0 }
  const cached = cache.get(d)
  if (cached) return cached

  let box
  try {
    if (typeof document !== 'undefined' && document.body) {
      ensureEl()
      pathEl.setAttribute('d', d)
      const b = pathEl.getBBox()
      box = { x: b.x, y: b.y, width: b.width, height: b.height }
      // jsdom returns all-zero; fall back to a point-based estimate.
      if (!box.width && !box.height) box = fallbackBBox(d)
    } else {
      box = fallbackBBox(d)
    }
  } catch {
    box = fallbackBBox(d)
  }

  if (cache.size > 1000) cache.clear()
  cache.set(d, box)
  return box
}
