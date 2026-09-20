import { geometryBBox } from '../model/bbox'

// Rasterise a raster-image node clipped to an arbitrary region, producing a new
// self-contained PNG data URL. Used by the "Intersect" boolean op when an image
// is involved: the result is a fresh image the size of the intersection, with
// everything outside the intersection outline erased to transparency.
//
// This is the DOM half of the op (an <img> decode + a <canvas>), kept out of
// geometry/boolean.js so that stays pure path math. geometry/boolean.js awaits
// this before handing the store a plain plan.

// Guard against a pathological allocation if an image was scaled up enormously
// before intersecting — the mask still looks right, just at a saner resolution.
const MAX_SIDE = 4096

/** Decode a data/URL string into an HTMLImageElement. */
function loadImage(href) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not decode the image to intersect'))
    img.src = href
  })
}

/**
 * @param imageNode  the source image node (plain, i.e. no baked `matrix`)
 * @param regionData SVG path data for the intersection outline, in page coords
 *                   (rotation/flip already baked in by nodeToPaperPath)
 * @param bounds     { x, y, width, height } bounding box of that outline
 * @returns { href, width, height } — a PNG data URL sized to `bounds`
 */
export async function rasterizeImageIntersection(imageNode, regionData, bounds) {
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null
  const img = await loadImage(imageNode.href)

  // Sample at the source image's own pixel density so quality is preserved,
  // separately per axis in case the image was stretched. Fall back to 1:1 when
  // the natural size is unknown (some SVG data URLs).
  const natW = img.naturalWidth || imageNode.width
  const natH = img.naturalHeight || imageNode.height
  let ppuX = imageNode.width > 0 ? natW / imageNode.width : 1
  let ppuY = imageNode.height > 0 ? natH / imageNode.height : 1
  const cap = Math.min(1, MAX_SIDE / (bounds.width * ppuX || 1), MAX_SIDE / (bounds.height * ppuY || 1))
  ppuX *= cap
  ppuY *= cap

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bounds.width * ppuX))
  canvas.height = Math.max(1, Math.round(bounds.height * ppuY))
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  // Map page coordinates → canvas pixels: the intersection box's top-left is the
  // canvas origin.
  ctx.setTransform(ppuX, 0, 0, ppuY, -bounds.x * ppuX, -bounds.y * ppuY)

  // Clip to the intersection outline (page space — matches regionData) before
  // any per-image transform, so a non-rectangular overlap erases to transparent.
  if (typeof Path2D === 'function') ctx.clip(new Path2D(regionData))

  // Draw the image under its own rotation/flip about its centre, mirroring
  // nodeTransform / nodeToPaperPath (flip first, then rotate).
  const b = geometryBBox(imageNode)
  const cx = b.x + b.width / 2
  const cy = b.y + b.height / 2
  ctx.save()
  ctx.translate(cx, cy)
  if (imageNode.flipX || imageNode.flipY) ctx.scale(imageNode.flipX ? -1 : 1, imageNode.flipY ? -1 : 1)
  if (imageNode.rotation) ctx.rotate((imageNode.rotation * Math.PI) / 180)
  ctx.translate(-cx, -cy)
  ctx.drawImage(img, imageNode.x, imageNode.y, imageNode.width, imageNode.height)
  ctx.restore()

  return { href: canvas.toDataURL('image/png'), width: bounds.width, height: bounds.height }
}
