// Grid drawn within the page bounds using nested SVG patterns (minor cells +
// a stronger line every 10 cells). Stroke widths are 1/zoom so lines render
// ~1px regardless of zoom; the grid hides itself when cells get too small.

export default function Grid({ size, zoom, width, height }) {
  if (!size) return null
  const cellPixels = size * zoom
  if (cellPixels < 6) return null // too dense to be useful

  const sw = 1 / zoom
  const major = size * 10

  return (
    <>
      <defs>
        <pattern id="ic-grid-minor" width={size} height={size} patternUnits="userSpaceOnUse">
          <path
            d={`M ${size} 0 L 0 0 L 0 ${size}`}
            fill="none"
            strokeWidth={sw}
            style={{ stroke: 'var(--canvas-grid)' }}
          />
        </pattern>
        <pattern id="ic-grid-major" width={major} height={major} patternUnits="userSpaceOnUse">
          <rect width={major} height={major} fill="url(#ic-grid-minor)" />
          <path
            d={`M ${major} 0 L 0 0 L 0 ${major}`}
            fill="none"
            strokeWidth={sw}
            style={{ stroke: 'var(--canvas-grid-strong)' }}
          />
        </pattern>
      </defs>
      <rect x={0} y={0} width={width} height={height} fill="url(#ic-grid-major)" />
    </>
  )
}
