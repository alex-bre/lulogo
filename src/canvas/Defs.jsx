/**
 * Renders the document's gradient paint servers. Linear gradients use the
 * default object-bounding-box vector (left→right) rotated by `angle`, so a
 * single angle field drives direction.
 */
export default function Defs({ gradients }) {
  const list = Object.values(gradients || {})
  if (!list.length) return null
  return (
    <defs>
      {list.map((g) =>
        g.type === 'radial' ? (
          <radialGradient key={g.id} id={g.id} cx="50%" cy="50%" r="50%">
            {g.stops.map((s, i) => (
              <stop key={i} offset={s.offset} stopColor={s.color} stopOpacity={s.opacity} />
            ))}
          </radialGradient>
        ) : (
          <linearGradient key={g.id} id={g.id} gradientTransform={`rotate(${g.angle || 0} 0.5 0.5)`}>
            {g.stops.map((s, i) => (
              <stop key={i} offset={s.offset} stopColor={s.color} stopOpacity={s.opacity} />
            ))}
          </linearGradient>
        ),
      )}
    </defs>
  )
}
