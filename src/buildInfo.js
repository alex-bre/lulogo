// Build identity, injected by vite.config.js `define` at build time.
//
// The point of this is traceability: "the boolean op broke" is unactionable
// without knowing which commit the reporter was running. Surfaced as a tooltip
// on the app name and logged once at startup, so it can be read back without
// any UI of its own.

export const APP_VERSION = __APP_VERSION__
export const COMMIT_SHA = __COMMIT_SHA__

/** e.g. `v0.1.0 (7317901)`, or `v0.1.0 (a1b2c3d-dirty)` for an uncommitted build. */
export const BUILD_LABEL = `v${APP_VERSION} (${COMMIT_SHA})`

/** Where the project lives. */
export const SOURCE_URL = __SOURCE_URL__

/**
 * The source of *this* build, which is what AGPL §13 asks for — a link to the
 * project's tip would not describe the version a user is actually running.
 *
 * Only a clean commit can be pointed at: "unknown" is not a revision, and a
 * "-dirty" build corresponds to no commit at all, so both fall back to the
 * project root rather than linking somewhere that 404s.
 */
export const BUILD_SOURCE_URL = /^[0-9a-f]{7,40}$/.test(COMMIT_SHA)
  ? `${SOURCE_URL}/tree/${COMMIT_SHA}`
  : SOURCE_URL
