import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DOCUMENT_VERSION, migrateDocument } from '../io/migrate'
import { serializeProject, parseProject } from '../io/project'
import { readAutosave, STORAGE_KEY, UNREADABLE_KEY } from '../state/store'
import { createDocument } from '../model/document'
import { createRect, addNode } from '../model/nodes'

const docWithOneRect = () => {
  const doc = createDocument()
  addNode(doc, createRect({ x: 1, y: 2, width: 3, height: 4 }))
  return doc
}

describe('document schema migration', () => {
  it('passes a current-version document straight through', () => {
    const doc = docWithOneRect()
    expect(migrateDocument(doc, DOCUMENT_VERSION)).toBe(doc)
  })

  it('treats a missing version as the pre-envelope schema', () => {
    const doc = docWithOneRect()
    expect(migrateDocument(doc, undefined)).toEqual(doc)
  })

  it('refuses a document from a newer build instead of misreading it', () => {
    expect(() => migrateDocument(docWithOneRect(), DOCUMENT_VERSION + 1)).toThrow(
      /newer version of the app/i,
    )
  })

  // The real chain is empty until the first breaking change, so the walk is
  // exercised through the test seam — it has to be correct the day it is first
  // used, not merely the day it is first written.
  it('walks the chain one step at a time, in order', () => {
    const seen = []
    const migrations = {
      1: (d) => (seen.push('1→2'), { ...d, two: true }),
      2: (d) => (seen.push('2→3'), { ...d, three: true }),
    }
    const out = migrateDocument({ nodes: {} }, 1, { migrations, target: 3 })

    expect(seen).toEqual(['1→2', '2→3'])
    expect(out).toEqual({ nodes: {}, two: true, three: true })
  })

  it('starts the walk from the document\'s own version, not from the beginning', () => {
    const seen = []
    const migrations = {
      1: (d) => (seen.push('1→2'), d),
      2: (d) => (seen.push('2→3'), d),
    }
    migrateDocument({ nodes: {} }, 2, { migrations, target: 3 })
    expect(seen).toEqual(['2→3'])
  })

  it('does not mutate the document it is given', () => {
    const original = { nodes: {} }
    const migrations = { 1: (d) => ({ ...d, added: true }) }
    const out = migrateDocument(original, 1, { migrations, target: 2 })

    expect(original).toEqual({ nodes: {} })
    expect(out).not.toBe(original)
  })

  it('reports a gap in the chain rather than silently skipping it', () => {
    // Nothing registered to take a v1 document forward to the v2 target.
    expect(() => migrateDocument({ nodes: {} }, 1, { migrations: {}, target: 2 })).toThrow(
      /No migration from document format v1 to v2/,
    )
  })
})

describe('project files carry the schema version', () => {
  it('stamps the current version on save', () => {
    expect(JSON.parse(serializeProject(docWithOneRect())).version).toBe(DOCUMENT_VERSION)
  })

  it('rejects a project file from a newer build', () => {
    const raw = JSON.stringify({
      format: 'lulogo-editor',
      version: DOCUMENT_VERSION + 1,
      document: docWithOneRect(),
    })
    expect(() => parseProject(raw)).toThrow(/newer version of the app/i)
  })

  it('still opens a project file written before the version was read', () => {
    const raw = JSON.stringify({ format: 'lulogo-editor', document: docWithOneRect() })
    expect(parseProject(raw).rootOrder).toHaveLength(1)
  })

  it('rejects a file that is not a project at all', () => {
    expect(() => parseProject(JSON.stringify({ format: 'something-else', document: {} }))).toThrow(
      /not a lulogo project file/i,
    )
  })
})

describe('autosave envelope', () => {
  it('reads the current envelope shape', () => {
    const doc = docWithOneRect()
    const raw = JSON.stringify({ version: DOCUMENT_VERSION, document: doc })
    expect(readAutosave(raw).rootOrder).toHaveLength(1)
  })

  it('reads a bare document written before the envelope existed', () => {
    const raw = JSON.stringify(docWithOneRect())
    expect(readAutosave(raw).rootOrder).toHaveLength(1)
  })

  it('rejects a value that is neither', () => {
    expect(readAutosave(JSON.stringify({ foo: 1 }))).toBe(null)
  })

  it('refuses an autosave from a newer build', () => {
    const raw = JSON.stringify({ version: DOCUMENT_VERSION + 1, document: docWithOneRect() })
    expect(() => readAutosave(raw)).toThrow(/newer version of the app/i)
  })
})

describe('an unreadable autosave is preserved, not overwritten', () => {
  let warn
  beforeEach(() => {
    localStorage.clear()
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    warn.mockRestore()
    localStorage.clear()
    vi.resetModules()
  })

  it('parks a future-version autosave under the fallback key', async () => {
    const raw = JSON.stringify({ version: DOCUMENT_VERSION + 1, document: docWithOneRect() })
    localStorage.setItem(STORAGE_KEY, raw)

    // The initial load runs at module evaluation, so the store must be
    // re-imported with the seeded storage in place.
    vi.resetModules()
    await import('../state/store')

    expect(localStorage.getItem(UNREADABLE_KEY)).toBe(raw)
    expect(localStorage.getItem(STORAGE_KEY)).toBe(null)
    expect(warn).toHaveBeenCalled()
  })
})
