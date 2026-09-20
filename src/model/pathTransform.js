// Apply a 2D affine matrix [a, b, c, d, e, f] to SVG path data, emitting
// absolute commands. Handles M/L/H/V/C/S/Q/T/Z (abs + rel) exactly; arcs (A)
// transform their endpoint and scale their radii (an approximation — our own
// shapes never use arcs, since pen/Paper output is M/L/C/Z).

const ARGS = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 }

const tokenize = (d) => d.match(/[a-zA-Z]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) || []
const isCmd = (t) => /[a-zA-Z]/.test(t)
const fmt = (n) => Math.round(n * 1000) / 1000

export function transformPathData(d, mat) {
  if (!d) return d
  const [a, b, c, dd, e, f] = mat
  const pt = (x, y) => [a * x + c * y + e, b * x + dd * y + f]

  const tokens = tokenize(d)
  const out = []
  let i = 0
  let cx = 0
  let cy = 0 // current point (absolute)
  let startX = 0
  let startY = 0 // subpath start
  let prevC2 = null // last cubic 2nd control (absolute), for S
  let prevQ = null // last quad control (absolute), for T

  const emit = (lower, rel, args) => {
    switch (lower) {
      case 'm':
      case 'l': {
        let [x, y] = args
        if (rel) {
          x += cx
          y += cy
        }
        const [X, Y] = pt(x, y)
        out.push(`${lower === 'm' ? 'M' : 'L'} ${fmt(X)} ${fmt(Y)}`)
        cx = x
        cy = y
        if (lower === 'm') {
          startX = x
          startY = y
        }
        prevC2 = prevQ = null
        break
      }
      case 'h':
      case 'v': {
        let x = cx
        let y = cy
        if (lower === 'h') x = rel ? cx + args[0] : args[0]
        else y = rel ? cy + args[0] : args[0]
        const [X, Y] = pt(x, y)
        out.push(`L ${fmt(X)} ${fmt(Y)}`)
        cx = x
        cy = y
        prevC2 = prevQ = null
        break
      }
      case 'c':
      case 's': {
        let x1, y1, x2, y2, x, y
        if (lower === 'c') {
          ;[x1, y1, x2, y2, x, y] = args
          if (rel) {
            x1 += cx
            y1 += cy
            x2 += cx
            y2 += cy
            x += cx
            y += cy
          }
        } else {
          ;[x2, y2, x, y] = args
          if (rel) {
            x2 += cx
            y2 += cy
            x += cx
            y += cy
          }
          // first control = reflection of previous second control
          x1 = prevC2 ? 2 * cx - prevC2.x : cx
          y1 = prevC2 ? 2 * cy - prevC2.y : cy
        }
        const A = pt(x1, y1)
        const B = pt(x2, y2)
        const C = pt(x, y)
        out.push(`C ${fmt(A[0])} ${fmt(A[1])} ${fmt(B[0])} ${fmt(B[1])} ${fmt(C[0])} ${fmt(C[1])}`)
        prevC2 = { x: x2, y: y2 }
        prevQ = null
        cx = x
        cy = y
        break
      }
      case 'q':
      case 't': {
        let x1, y1, x, y
        if (lower === 'q') {
          ;[x1, y1, x, y] = args
          if (rel) {
            x1 += cx
            y1 += cy
            x += cx
            y += cy
          }
        } else {
          ;[x, y] = args
          if (rel) {
            x += cx
            y += cy
          }
          x1 = prevQ ? 2 * cx - prevQ.x : cx
          y1 = prevQ ? 2 * cy - prevQ.y : cy
        }
        const A = pt(x1, y1)
        const C = pt(x, y)
        out.push(`Q ${fmt(A[0])} ${fmt(A[1])} ${fmt(C[0])} ${fmt(C[1])}`)
        prevQ = { x: x1, y: y1 }
        prevC2 = null
        cx = x
        cy = y
        break
      }
      case 'a': {
        let [rx, ry, rot, laf, sf, x, y] = args
        if (rel) {
          x += cx
          y += cy
        }
        const scaleX = Math.hypot(a, b)
        const scaleY = Math.hypot(c, dd)
        const [X, Y] = pt(x, y)
        out.push(`A ${fmt(rx * scaleX)} ${fmt(ry * scaleY)} ${fmt(rot)} ${laf} ${sf} ${fmt(X)} ${fmt(Y)}`)
        cx = x
        cy = y
        prevC2 = prevQ = null
        break
      }
    }
  }

  while (i < tokens.length) {
    const cmd = tokens[i++]
    const lower = cmd.toLowerCase()
    const rel = cmd === lower
    const n = ARGS[lower]
    if (lower === 'z') {
      out.push('Z')
      cx = startX
      cy = startY
      prevC2 = prevQ = null
      continue
    }
    if (n === undefined) continue
    let first = true
    do {
      const args = []
      for (let k = 0; k < n; k++) args.push(parseFloat(tokens[i++]))
      // An implicit repeat of moveto is a lineto.
      emit(lower === 'm' && !first ? 'l' : lower, rel, args)
      first = false
    } while (i < tokens.length && !isCmd(tokens[i]))
  }

  return out.join(' ')
}
