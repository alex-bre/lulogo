// As much of the PNG container format as an embedded text chunk needs: walk the
// chunks, and splice a new one in ahead of the pixel data.
//
// A PNG is an 8-byte signature followed by chunks of
// `[length:4][type:4][data:length][crc:4]`, big-endian throughout. Decoders are
// required to ignore chunk types they don't know, which is what lets the
// project source ride along inside an ordinary image that every viewer still
// opens (see `embedSource.js`).

export const PNG_SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10)

let table = null
function crcTable() {
  if (table) return table
  table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
}

/** The CRC-32 every chunk is trailed by, over its type *and* data bytes. */
export function crc32(bytes) {
  const t = crcTable()
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export function isPngBytes(bytes) {
  return !!bytes && bytes.length >= 8 && PNG_SIGNATURE.every((b, i) => bytes[i] === b)
}

const ascii = (s) => Uint8Array.from(s, (ch) => ch.charCodeAt(0) & 0xff)

// Spread-free, because a chunk's text can run to megabytes and
// `String.fromCharCode(...bytes)` overflows the argument list long before that.
export function latin1(bytes) {
  let out = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  }
  return out
}
const typeAt = (bytes, at) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3])

/**
 * Walk the chunks in file order, yielding `{ type, at, data }` where `at` is the
 * chunk's own start offset. Stops at IEND, or early on a truncated file rather
 * than reading past the end — a half-downloaded image is not worth throwing for.
 */
export function* readChunks(bytes) {
  if (!isPngBytes(bytes)) return
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let at = 8
  while (at + 8 <= bytes.length) {
    const length = view.getUint32(at)
    const dataAt = at + 8
    if (dataAt + length + 4 > bytes.length) return
    const type = typeAt(bytes, at + 4)
    yield { type, at, data: bytes.subarray(dataAt, dataAt + length) }
    if (type === 'IEND') return
    at = dataAt + length + 4
  }
}

/**
 * Return a copy of `bytes` with one more chunk in it, placed before the first
 * IDAT — ancillary chunks are allowed there, and a reader that only wants the
 * metadata then never has to walk the pixel data to find it.
 */
export function insertChunk(bytes, type, data) {
  let at = -1
  for (const chunk of readChunks(bytes)) {
    if (chunk.type === 'IDAT' || chunk.type === 'IEND') {
      at = chunk.at
      break
    }
  }
  if (at < 0) throw new Error('Not a PNG file')

  const chunk = new Uint8Array(12 + data.length)
  const view = new DataView(chunk.buffer)
  view.setUint32(0, data.length)
  chunk.set(ascii(type), 4)
  chunk.set(data, 8)
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)))

  const out = new Uint8Array(bytes.length + chunk.length)
  out.set(bytes.subarray(0, at), 0)
  out.set(chunk, at)
  out.set(bytes.subarray(at), at + chunk.length)
  return out
}

/** The data bytes of a tEXt chunk: `keyword`, a NUL, then Latin-1 text. */
export function encodeTextChunk(keyword, text) {
  const k = ascii(keyword)
  const t = ascii(text)
  const data = new Uint8Array(k.length + 1 + t.length)
  data.set(k, 0)
  data.set(t, k.length + 1)
  return data
}

/**
 * The text stored under `keyword`, or null when the file carries no such chunk.
 *
 * Only tEXt is read: it is what we write, and the compressed (zTXt) and
 * internationalized (iTXt) forms exist for text this never puts there.
 */
export function readTextChunk(bytes, keyword) {
  for (const chunk of readChunks(bytes)) {
    if (chunk.type !== 'tEXt') continue
    const nul = chunk.data.indexOf(0)
    if (nul < 0) continue
    if (latin1(chunk.data.subarray(0, nul)) !== keyword) continue
    return latin1(chunk.data.subarray(nul + 1))
  }
  return null
}
