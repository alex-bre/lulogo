// Shared test fixtures. Not a spec file — vitest only collects *.test.*.

/**
 * A 1×1 transparent PNG: a real file, so chunk-level code is exercised against
 * bytes it did not write itself.
 */
export const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

export function tinyPng() {
  return Uint8Array.from(atob(TINY_PNG), (ch) => ch.charCodeAt(0))
}

/**
 * jsdom never decodes an <img>, so any code path that waits on `onload` — the
 * image import, for one — would wait forever. Hand `vi.stubGlobal('Image', …)`
 * this stand-in, and remember to `vi.unstubAllGlobals()`.
 */
export class StubImage {
  naturalWidth = 1
  naturalHeight = 1
  set src(value) {
    this._src = value
    queueMicrotask(() => this.onload?.())
  }
  get src() {
    return this._src
  }
}
