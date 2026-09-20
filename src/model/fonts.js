// Curated font families available for text. The first block is bundled with the
// app (the files in public/fonts, registered as @font-face from JS — see
// installFontFaces below), so those render on-canvas and outline exactly on
// text→paths. The rest are system/web-safe stacks that render only if installed
// on the viewer's machine.
export const FONT_FAMILIES = [
  { value: 'Outfit, sans-serif', label: 'Outfit' },
  { value: '"Work Sans", sans-serif', label: 'Work Sans' },
  { value: '"Space Grotesk", sans-serif', label: 'Space Grotesk' },
  { value: '"Playfair Display", serif', label: 'Playfair Display' },
  { value: '"JetBrains Mono", monospace', label: 'JetBrains Mono' },
  { value: 'Inter, sans-serif', label: 'Inter' },
  { value: 'Arial, Helvetica, sans-serif', label: 'Arial' },
  { value: 'Verdana, Geneva, sans-serif', label: 'Verdana' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: '"Times New Roman", Times, serif', label: 'Times' },
  { value: '"Courier New", Courier, monospace', label: 'Courier' },
  { value: '"Comic Sans MS", "Comic Sans", cursive', label: 'Comic Sans' },
]

export const FONT_WEIGHTS = [
  { value: 400, label: 'Regular' },
  { value: 500, label: 'Medium' },
  { value: 600, label: 'Semibold' },
  { value: 700, label: 'Bold' },
]

/**
 * Which of the three bundled outline faces a family maps to. This is the single
 * source of truth shared by on-canvas rendering and text→paths export, so the
 * two never disagree about which fallback to use.
 */
export function fontKind(family) {
  const f = (family || '').toLowerCase()
  if (f.includes('mono') || f.includes('courier') || f.includes('consol')) return 'mono'
  if (f.includes('times') || f.includes('georgia') || f.includes('garamond')) return 'serif'
  if (f.includes('serif') && !f.includes('sans')) return 'serif'
  return 'sans'
}

/**
 * URL of a file in public/fonts. Built from Vite's BASE_URL (the app is served
 * with `base: './'`), so it resolves correctly under a sub-path — e.g. the proxy
 * VS Code's built-in browser serves the dev server through. A root-absolute
 * '/fonts/…' would 404 there while working at the root in a normal browser, and
 * the two would then render text with different fallback fonts.
 */
export const fontUrl = (file) => `${import.meta.env.BASE_URL}fonts/${file}`

/**
 * Brand faces, keyed by the family's primary name (lowercased). Files live in
 * public/fonts.
 *
 * `weightRange` marks a *variable* font: one file covering a whole `wght` axis.
 * It must be declared to CSS as a range or the browser pins it to a single
 * weight and fakes the rest (outfit.ttf carries wght 100–900, and its axis
 * default is 100/Thin — so pinning it to 400 would be wrong at every weight).
 *
 * `bold` is a separate static file, for a face shipped as discrete weights
 * rather than an axis. If it isn't shipped, the weight simply isn't available —
 * we never fake it (see resolveWeight).
 */
export const BRAND_FONTS = {
  outfit: { family: 'Outfit', regular: 'outfit.ttf', weightRange: [100, 900] },
  'work sans': { family: 'Work Sans', regular: 'work-sans.ttf', weightRange: [100, 900] },
  'space grotesk': { family: 'Space Grotesk', regular: 'space-grotesk.ttf', weightRange: [300, 700] },
  'playfair display': { family: 'Playfair Display', regular: 'playfair-display.ttf', weightRange: [400, 900] },
  'jetbrains mono': { family: 'JetBrains Mono', regular: 'jetbrains-mono.ttf', weightRange: [100, 800] },
}

/** Primary family of a CSS font-family stack, unquoted and lowercased. */
export function primaryFamily(stack) {
  return String(stack || '').split(',')[0].trim().replace(/^["']|["']$/g, '').toLowerCase()
}

// Private faces backed by the very files the exporter outlines with. Every text
// stack falls back to one of these (see renderFontFamily), so canvas and export
// agree even when the chosen font isn't available.
export const FALLBACK_FONTS = {
  sans: { family: 'IC Fallback Sans', regular: 'sans.ttf' },
  serif: { family: 'IC Fallback Serif', regular: 'serif.ttf' },
  mono: { family: 'IC Fallback Mono', regular: 'mono.ttf' },
}

const FALLBACK_FACE = {
  sans: `"${FALLBACK_FONTS.sans.family}"`,
  serif: `"${FALLBACK_FONTS.serif.family}"`,
  mono: `"${FALLBACK_FONTS.mono.family}"`,
}

// The weights we actually shipped, per brand key: static weights, or a variable
// font's axis range. Filled in as the files load — a file that 404s is never
// recorded, so resolveWeight can't offer a weight we don't have.
const loadedWeights = new Map() // key -> { statics: Set<number>, range: [min,max] | null }

const entryFor = (key) => {
  if (!loadedWeights.has(key)) loadedWeights.set(key, { statics: new Set(), range: null })
  return loadedWeights.get(key)
}

/**
 * Register every bundled font face. Awaited before the first paint (main.jsx):
 * text can't be laid out until we know which faces exist.
 *
 * Declared from JS, not global.css, because only here can the URL be built from
 * BASE_URL — CSS can't see it, and a relative url() in a stylesheet resolves
 * against the stylesheet, which is wrong for files in public/. And via the
 * FontFace API rather than an injected @font-face, so a missing file is skipped
 * and reported: a declared-but-404 face would leave the browser free to
 * synthesize the weight.
 */
let installed = false
export function installFontFaces() {
  if (installed || typeof document === 'undefined' || !document.fonts || typeof FontFace === 'undefined') {
    return Promise.resolve()
  }
  installed = true

  const add = (family, file, weight, record) => {
    const ff = new FontFace(family, `url(${fontUrl(file)}) format('truetype')`, { weight, display: 'swap' })
    return ff
      .load()
      .then((f) => {
        document.fonts.add(f)
        record?.()
      })
      .catch(() => {
        console.warn(
          `Font file missing: public/fonts/${file} — "${family}" ${weight} is unavailable. ` +
            `It will NOT be synthesized (a faked weight can't be reproduced by "text → paths"); ` +
            `text asking for it renders the nearest weight that is actually shipped.`,
        )
      })
  }

  const pending = []
  for (const [key, b] of Object.entries(BRAND_FONTS)) {
    if (b.weightRange) {
      // A variable font: one file spanning a whole weight axis.
      pending.push(
        add(b.family, b.regular, `${b.weightRange[0]} ${b.weightRange[1]}`, () => {
          entryFor(key).range = b.weightRange
        }),
      )
    } else {
      pending.push(add(b.family, b.regular, '400', () => entryFor(key).statics.add(400)))
      if (b.bold) pending.push(add(b.family, b.bold, '700', () => entryFor(key).statics.add(700)))
    }
  }
  // The fallback faces are weight-400 only, and aren't resolved by weight.
  for (const f of Object.values(FALLBACK_FONTS)) pending.push(add(f.family, f.regular, '400'))

  return Promise.all(pending)
}

/** Seed the registry from tests (jsdom has no FontFace API). */
export function registerLoadedForTest(key, { statics = [], range = null } = {}) {
  loadedWeights.set(key, { statics: new Set(statics), range })
}

/**
 * The weight a text node can actually be *rendered and outlined* at.
 *
 * A missing weight is never synthesized: a faked bold is a smear of the regular
 * outlines that text→paths cannot reproduce, so the canvas and the export would
 * disagree. `font-synthesis: none` alone wouldn't be enough either — canvas
 * measureText, which drives our boxes, has no synthesis switch, so it would keep
 * measuring the forgery. Asking only for weights we shipped makes rendering,
 * measurement and export agree by construction.
 *
 * Only bundled families can be resolved this way; for system fonts we can't
 * enumerate the weights, so `font-synthesis: none` is what keeps those honest.
 */
export function resolveWeight(family, weight) {
  const want = weight || 400
  const key = primaryFamily(family)
  const entry = loadedWeights.get(key)
  if (!entry) return want // not a bundled family — CSS font-synthesis governs it
  if (entry.range) return Math.min(entry.range[1], Math.max(entry.range[0], want))
  if (!entry.statics.size || entry.statics.has(want)) return want
  // Nearest shipped weight; ties go to the heavier one.
  return [...entry.statics].reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a))
}

// CSS generic keywords always resolve to *something*, so anything listed after
// one is unreachable.
const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui'])

/**
 * The font-family string to actually *render* a text node with: the bundled
 * fallback face that text→paths would outline with, spliced in ahead of the
 * stack's generic keyword (after it, the browser would never reach it). So when
 * the chosen font isn't available the canvas shows the same glyphs the export
 * produces — no shift between what you see and what you get.
 */
export function renderFontFamily(family) {
  const stack = (family || 'sans-serif').split(',').map((s) => s.trim()).filter(Boolean)
  const at = stack.findIndex((s) => GENERIC.has(s.toLowerCase()))
  const face = FALLBACK_FACE[fontKind(family)]
  if (at === -1) stack.push(face)
  else stack.splice(at, 0, face)
  return stack.join(', ')
}
