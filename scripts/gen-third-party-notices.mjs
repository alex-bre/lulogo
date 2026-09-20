// Regenerates THIRD-PARTY-NOTICES from the installed production dependency tree.
//
// The MIT and ISC licences of our dependencies require their copyright notices
// to travel with the *distributed* build, not merely with the repository. Vite
// does not do this — it strips comments when minifying — so the notices file is
// what discharges the obligation, and it has to be regenerated whenever the
// production dependency closure changes.
//
//   npm run notices
//
// Dev dependencies are deliberately excluded: they never reach a user.
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const LICENSE_FILE = /^(LICENSE|LICENCE|COPYING)/i

/**
 * Licence texts for packages that ship none of their own.
 *
 * A package can declare a licence in package.json and still publish no licence
 * file — but the ISC and MIT notice clauses attach to the *distribution*, so the
 * text has to come from somewhere or the build ships code with no notice at all.
 * Each entry below is the licence the package declares, filled in with the
 * copyright holder its own metadata names. Keyed by package name; the version is
 * recorded so a bump is a prompt to re-check that upstream still ships nothing.
 */
const MANUAL_NOTICES = {
  // boolbase 1.0.0 (2014) has no LICENSE file in the tarball or upstream repo;
  // package.json declares ISC, author "Felix Boehm <me@feedic.com>".
  boolbase: {
    version: '1.0.0',
    text: `ISC License

Copyright (c) Felix Boehm <me@feedic.com>

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.

(Reproduced from the ISC licence this package declares: it publishes no
licence file of its own.)`,
  },
}

// `npm ls` exits non-zero on things we do not care about here — an unmet
// optional peer, an extraneous package — while still printing a complete tree.
// Trust the JSON, not the exit code.
function dependencyTree() {
  const opts = { encoding: 'utf8', maxBuffer: 32e6 }
  try {
    return execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], opts)
  } catch (err) {
    if (err.stdout) return err.stdout
    throw err
  }
}

const tree = JSON.parse(dependencyTree())

const names = new Set()
;(function walk(node) {
  for (const [name, child] of Object.entries(node.dependencies ?? {})) {
    if (names.has(name)) continue
    names.add(name)
    walk(child)
  }
})(tree)

const sections = []
const missing = []

for (const name of [...names].sort()) {
  // Types-only packages are erased at build time and never reach the bundle.
  // They also show up in the tree as unresolved optional peers, so skip them
  // before the install check or they read as a missing notice.
  if (name.startsWith('@types/')) continue

  const dir = join('node_modules', name)
  if (!existsSync(dir)) {
    missing.push(`${name} (not installed)`)
    continue
  }
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const licenseFile = readdirSync(dir).find((f) => LICENSE_FILE.test(f))

  const manual = !licenseFile && MANUAL_NOTICES[name]
  if (!licenseFile && !manual) {
    missing.push(`${name} (declares "${pkg.license ?? '?'}" but ships no licence file)`)
    continue
  }
  if (manual && manual.version !== pkg.version) {
    missing.push(
      `${name} (manual notice was written for ${manual.version}, installed ${pkg.version} — re-check upstream)`,
    )
  }

  const text = manual
    ? manual.text.trimEnd()
    : readFileSync(join(dir, licenseFile), 'utf8').trimEnd()
  sections.push(
    `${'-'.repeat(78)}\n${name} ${pkg.version}\nLicence: ${pkg.license ?? 'see below'}\n` +
      `${pkg.homepage ? `Homepage: ${pkg.homepage}\n` : ''}${'-'.repeat(78)}\n\n${text}\n`,
  )
}

if (missing.length) {
  console.error('Packages needing a manual notice entry:\n  ' + missing.join('\n  '))
}

const header = `THIRD-PARTY NOTICES

This file lists the open-source packages bundled into the production build of
this application, together with their licences. It is generated — run
\`npm run notices\` to refresh it after changing dependencies.

Contents: ${sections.length} packages.

`

writeFileSync('THIRD-PARTY-NOTICES', header + sections.join('\n'))
console.log(`Wrote THIRD-PARTY-NOTICES (${sections.length} packages).`)
