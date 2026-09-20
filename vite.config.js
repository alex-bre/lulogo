/// <reference types="vitest" />
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

const git = (args) =>
  execFileSync('git', args, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()

/**
 * Which commit a build came from. Without this a bug report names no code: the
 * app deploys continuously and package.json's version rarely moves.
 *
 * Falls back rather than failing. CI exports GITHUB_SHA, and the Docker build
 * has no `.git` at all (`.dockerignore` excludes it), so an absent git
 * directory is an expected state and not a build error.
 */
function commitSha() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7)
  try {
    // A dirty tree means the bundle does not match any commit — worth knowing
    // when a local build behaves differently from the deployed one.
    //
    // Tracked files only. Vite writes a `vite.config.js.timestamp-*.mjs` beside
    // this file while loading it, so an untracked-inclusive status is never
    // empty during a build and would mark every build dirty.
    const dirty = git(['status', '--porcelain', '--untracked-files=no'])
    return git(['rev-parse', '--short', 'HEAD']) + (dirty ? '-dirty' : '')
  } catch {
    return 'unknown'
  }
}

/**
 * Licence texts that have to ship inside the build, as `[source, servedAs]`.
 *
 * The MIT and ISC terms of our dependencies require their copyright notices to
 * accompany the *distributed build*, and minified bundles carry none. Both files
 * belong at the repository root — that is where GitHub's licence detection and
 * every other convention looks for them, and where CI's staleness check for
 * THIRD-PARTY-NOTICES points — so the root copies stay the single source of
 * truth and the build takes a copy instead.
 *
 * `.txt` is deliberate: a static host has no MIME type for an extensionless
 * `LICENSE` and offers it as a download rather than showing it.
 */
const SHIPPED_LICENCE_FILES = [
  ['LICENSE', 'LICENSE.txt'],
  ['THIRD-PARTY-NOTICES', 'THIRD-PARTY-NOTICES.txt'],
]

function shipLicenceFiles() {
  const read = (src) => readFileSync(new URL(`./${src}`, import.meta.url), 'utf8')
  return {
    name: 'ship-licence-files',
    // Emitted rather than copied by hand so they follow `outDir` and cannot be
    // left behind by a `dist/` that was cleaned between steps.
    generateBundle() {
      for (const [src, fileName] of SHIPPED_LICENCE_FILES) {
        this.emitFile({ type: 'asset', fileName, source: read(src) })
      }
    },
    // The About dialog links to these, so they have to resolve in `vite dev`
    // too — a link that only works in a production build is a link nobody
    // notices is broken.
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url || '').split('?')[0]
        const entry = SHIPPED_LICENCE_FILES.find(([, fileName]) => path === `/${fileName}`)
        if (!entry) return next()
        res.setHeader('Content-Type', 'text/plain; charset=utf-8')
        res.end(read(entry[0]))
      })
    },
  }
}

// `base: './'` keeps asset paths relative so the static build can be served
// from any sub-path (or opened offline) — useful for the offline smoke test.
export default defineConfig({
  plugins: [react(), shipLicenceFiles()],
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __COMMIT_SHA__: JSON.stringify(commitSha()),
    // AGPL §13 obliges us to offer network users the source. Taken from
    // package.json so moving the repository is a one-line change.
    __SOURCE_URL__: JSON.stringify(
      pkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, ''),
    ),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.js'],
  },
})
