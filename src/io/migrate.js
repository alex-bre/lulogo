/**
 * The document *schema* version, and the chain that brings older documents up
 * to it.
 *
 * This is the version that matters to users: it decides whether a file they
 * saved months ago still opens. It is deliberately independent of the app
 * version in package.json — the app ships continuously while the schema changes
 * rarely, and tying them together would force a schema bump on every release.
 *
 * To make a breaking change to the document model:
 *   1. bump DOCUMENT_VERSION
 *   2. add MIGRATIONS[<the version being left behind>]
 * Every older document then walks the chain up to current, one step at a time,
 * so a v1 file opens in a v5 build without anyone writing a v1→v5 special case.
 */
export const DOCUMENT_VERSION = 1

/**
 * MIGRATIONS[n] takes a version-n document and returns a version-(n+1) one.
 * Empty today: version 1 is the only schema that has ever shipped.
 *
 * A step must not mutate its input — callers may still hold the original.
 */
const MIGRATIONS = {}

// Documents written before the version envelope existed carry no version at
// all. They predate any schema change, so they are v1 by definition.
const ASSUMED_LEGACY_VERSION = 1

/**
 * Bring a document up to DOCUMENT_VERSION, or throw explaining why it can't be.
 *
 * `migrations` and `target` are seams for tests. The real chain is empty until
 * the first breaking change, so without them the walk could only be proven
 * correct after something already depended on it.
 */
export function migrateDocument(doc, version, { migrations = MIGRATIONS, target = DOCUMENT_VERSION } = {}) {
  let v = Number.isInteger(version) ? version : ASSUMED_LEGACY_VERSION

  if (v > target) {
    // Downgrading is not attempted: a newer build may have written fields this
    // one would silently drop, and dropping them is indistinguishable from data
    // loss from the user's side.
    throw new Error(
      `This file was saved by a newer version of the app (document format v${v}; ` +
        `this build reads v${target}). Update the app to open it.`,
    )
  }

  let out = doc
  while (v < target) {
    const step = migrations[v]
    if (!step) throw new Error(`No migration from document format v${v} to v${v + 1}.`)
    out = step(out)
    v += 1
  }
  return out
}
