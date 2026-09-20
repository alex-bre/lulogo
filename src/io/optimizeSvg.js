// SVG minification, in the spirit of SVGOMG: run the exported markup through
// SVGO with an explicit, user-toggleable plugin list rather than a fixed
// preset, so anything that changes the picture can be switched off and the
// result verified in the preview before it is downloaded.
//
// SVGO is loaded on demand (see `loadSvgo`) — the browser bundle is ~780 kB of
// parser, CSS engine and path arithmetic that nobody who never opens the
// optimize dialog should have to download.

import { hasEmbeddedSource } from './embedSource'

const SETTINGS_KEY = 'lulogo.optimize.v1'

/**
 * The plugin catalogue, **in the order SVGO must run them**.
 *
 * Order is not cosmetic: SVGO applies plugins as a pipeline, and e.g.
 * `convertShapeToPath` has to precede `mergePaths` for merging to see anything.
 * The sequence below is svgo's own `preset-default` order with the optional
 * plugins slotted in where they belong, so the list can be presented to the
 * user as-is and passed to SVGO as-is.
 *
 * `on` is the default state. Plugins that can visibly change or lose artwork
 * default to off — this is an editor's export path, where "smaller" must never
 * silently mean "different".
 */
export const OPTIMIZE_PLUGINS = [
  { id: 'removeDoctype', label: 'Remove doctype', on: true },
  { id: 'removeXMLProcInst', label: 'Remove XML instructions', on: true },
  { id: 'removeComments', label: 'Remove comments', on: true },
  { id: 'removeDeprecatedAttrs', label: 'Remove deprecated attributes', on: true },
  { id: 'removeMetadata', label: 'Remove <metadata>', on: true },
  { id: 'removeEditorsNSData', label: 'Remove editor data', on: true },
  { id: 'removeTitle', label: 'Remove <title>', note: 'Screen readers announce it', on: false },
  { id: 'removeDesc', label: 'Remove <desc>', on: true },
  { id: 'cleanupAttrs', label: 'Clean up attribute whitespace', on: true },
  { id: 'mergeStyles', label: 'Merge <style> elements', on: true },
  { id: 'inlineStyles', label: 'Inline styles', on: true },
  { id: 'minifyStyles', label: 'Minify styles', on: true },
  { id: 'cleanupIds', label: 'Minify IDs, drop unused ones', on: true },
  { id: 'removeUselessDefs', label: 'Remove unreferenced defs', on: true },
  { id: 'cleanupNumericValues', label: 'Round numbers', on: true },
  { id: 'cleanupListOfValues', label: 'Round lists of numbers', on: false },
  { id: 'convertColors', label: 'Shorten colours', on: true },
  { id: 'removeUnknownsAndDefaults', label: 'Remove unknowns and defaults', on: true },
  { id: 'removeNonInheritableGroupAttrs', label: 'Remove non-inheritable group attributes', on: true },
  { id: 'removeUselessStrokeAndFill', label: 'Remove useless stroke and fill', on: true },
  { id: 'removeViewBox', label: 'Remove viewBox', note: 'The file stops scaling', on: false },
  { id: 'cleanupEnableBackground', label: 'Clean up enable-background', on: true },
  { id: 'removeHiddenElems', label: 'Remove hidden elements', on: true },
  { id: 'removeEmptyText', label: 'Remove empty text', on: true },
  { id: 'convertShapeToPath', label: 'Shapes to paths', on: true },
  { id: 'convertEllipseToCircle', label: 'Round ellipses to circles', on: true },
  { id: 'moveElemsAttrsToGroup', label: 'Move common attributes to the group', on: true },
  { id: 'moveGroupAttrsToElems', label: 'Move group attributes to elements', on: true },
  { id: 'collapseGroups', label: 'Collapse useless groups', on: true },
  { id: 'convertPathData', label: 'Rewrite path data', on: true },
  { id: 'convertTransform', label: 'Rewrite transforms', on: true },
  { id: 'removeEmptyAttrs', label: 'Remove empty attributes', on: true },
  { id: 'removeEmptyContainers', label: 'Remove empty containers', on: true },
  { id: 'mergePaths', label: 'Merge paths', on: true },
  { id: 'removeUnusedNS', label: 'Remove unused namespaces', on: true },
  { id: 'reusePaths', label: 'Reuse repeated paths via <use>', on: false },
  { id: 'sortAttrs', label: 'Sort attributes', note: 'Compresses better over the wire', on: true },
  { id: 'sortDefsChildren', label: 'Sort children of <defs>', on: true },
  { id: 'removeXlink', label: 'Replace xlink with SVG 2', on: true },
  { id: 'removeScripts', label: 'Remove scripts', on: true },
  { id: 'convertOneStopGradients', label: 'Single-stop gradients to a flat colour', on: true },
  { id: 'removeDimensions', label: 'Remove width/height, keep viewBox', note: 'Makes the file fluid', on: false },
  { id: 'removeOffCanvasPaths', label: 'Remove paths outside the page', on: false },
  { id: 'removeRasterImages', label: 'Remove embedded images', note: 'Drops imported bitmaps', on: false },
  { id: 'removeStyleElement', label: 'Remove <style> elements', note: 'Drops baked-in animation', on: false },
  { id: 'prefixIds', label: 'Prefix IDs and classes', note: 'For inlining next to other SVGs', on: false },
]

const PLUGIN_IDS = new Set(OPTIMIZE_PLUGINS.map((p) => p.id))

export const DEFAULT_SETTINGS = {
  precision: 3, // digits kept on coordinates and other numbers
  transformPrecision: 5, // matrices lose accuracy faster, so they get more
  multipass: true,
  pretty: false,
  plugins: Object.fromEntries(OPTIMIZE_PLUGINS.map((p) => [p.id, p.on])),
}

/**
 * Why a plugin can be held off, keyed by its id — the dialog shows these, so a
 * disabled checkbox never looks like a bug.
 */
export const FORCED_OFF_REASONS = {
  inlineStyles:
    'This file animates from an embedded stylesheet, so “Inline styles” is held off — it would move the ' +
    'animation off the elements the keyframes target.',
  removeMetadata:
    'This file carries its editable project source, so “Remove <metadata>” is held off — it would strip ' +
    'the source out and leave a picture that no longer reopens.',
}

/**
 * Plugins that would break *this particular* file, whatever the settings say.
 *
 * The animated export targets its nodes from an embedded stylesheet, and
 * `inlineStyles` moves those declarations onto the elements it thinks match —
 * which relocates a wrapper group's animation onto its child and can drop the
 * class the keyframes were written against. Rather than let a checkbox quietly
 * de-animate the artwork, it is held off whenever a <style> is present and the
 * dialog says so. An embedded project source is held off the same way: it lives
 * in <metadata>, which `removeMetadata` exists to delete.
 */
export function forcedOffPlugins(svg) {
  const off = []
  if (/<style[\s>]/.test(svg)) off.push('inlineStyles')
  if (hasEmbeddedSource(svg)) off.push('removeMetadata')
  return off
}

/** Fill in anything missing/invalid, and apply this file's forced-off plugins. */
export function resolveSettings(settings, svg = '') {
  const s = { ...DEFAULT_SETTINGS, ...settings }
  const clamp = (v, d) => (Number.isFinite(v) ? Math.min(8, Math.max(0, Math.round(v))) : d)
  const plugins = { ...DEFAULT_SETTINGS.plugins }
  for (const [id, on] of Object.entries(settings?.plugins ?? {})) {
    if (PLUGIN_IDS.has(id)) plugins[id] = !!on
  }
  for (const id of forcedOffPlugins(svg)) plugins[id] = false
  return {
    precision: clamp(s.precision, DEFAULT_SETTINGS.precision),
    transformPrecision: clamp(s.transformPrecision, DEFAULT_SETTINGS.transformPrecision),
    multipass: !!s.multipass,
    pretty: !!s.pretty,
    plugins,
  }
}

/** The `plugins` array SVGO expects, enabled-only and in pipeline order. */
function pluginList(resolved) {
  return OPTIMIZE_PLUGINS.filter((p) => resolved.plugins[p.id]).map((p) =>
    p.id === 'convertTransform'
      ? { name: p.id, params: { transformPrecision: resolved.transformPrecision } }
      : p.id,
  )
}

// One import, shared by every run. Kept as the promise so overlapping calls
// (the dialog re-optimizes on every slider tick) don't each start a load.
let svgoPromise = null
export function loadSvgo() {
  if (!svgoPromise) svgoPromise = import('svgo/browser')
  return svgoPromise
}

/**
 * Minify `svg` and return the result plus what it cost.
 *
 * Throws nothing on a plugin failure that SVGO can recover from; a genuine
 * parse error propagates, and the caller shows it instead of a broken preview.
 */
export async function optimizeSvg(svg, settings = DEFAULT_SETTINGS) {
  const resolved = resolveSettings(settings, svg)
  const { optimize } = await loadSvgo()
  const { data } = optimize(svg, {
    multipass: resolved.multipass,
    floatPrecision: resolved.precision,
    js2svg: { pretty: resolved.pretty, indent: 2 },
    plugins: pluginList(resolved),
  })
  return { data, resolved }
}

/** Bytes on disk — the file is written as UTF-8, so character count won't do. */
export function byteLength(text) {
  return new TextEncoder().encode(text).length
}

/**
 * Bytes after gzip, or null where the browser has no CompressionStream.
 *
 * Worth showing because it is the number that actually reaches a visitor: every
 * static host serves SVG compressed, and some optimizations (sorting attributes
 * above all) barely move the raw size while helping this one a lot.
 */
export async function gzipLength(text) {
  if (typeof CompressionStream === 'undefined') return null
  try {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
    return (await new Response(stream).blob()).size
  } catch {
    return null
  }
}

export function formatBytes(n) {
  if (n == null) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 2 : 1)} kB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

/** Remembered across sessions, so the dialog opens where it was left. */
export function loadSettings() {
  try {
    return resolveSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null') || undefined)
  } catch {
    return resolveSettings(undefined)
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    /* storage full or unavailable — the settings just won't outlive the tab */
  }
}
