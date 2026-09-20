#!/usr/bin/env node
/**
 * Cuts a release locally: writes the changelog entry, bumps the version
 * everywhere it is written down, commits and tags.
 *
 *   node scripts/release.mjs 0.4.0     # explicit version
 *   node scripts/release.mjs --minor   # or --patch / --major
 *   node scripts/release.mjs --minor --dry-run
 *
 * Nothing is pushed. Review the commit, then `git push --follow-tags`; the tag
 * is what triggers the Release workflow.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const ROOT = new URL('../', import.meta.url)
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8')
const write = (p, s) => writeFileSync(new URL(p, ROOT), s)
const git = (...args) =>
  execFileSync('git', args, { stdio: ['ignore', 'pipe', 'inherit'] }).toString().trim()

/**
 * Commit types to changelog sections, in the order they should appear.
 *
 * A type absent from this table is omitted from the changelog — that is how
 * `test:`, `ci:` and `chore:` stay out of it. Carried over verbatim from the
 * old `release-please-config.json`.
 */
const SECTIONS = [
  ['feat', 'Features'],
  ['fix', 'Bug Fixes'],
  ['perf', 'Performance'],
  ['revert', 'Reverts'],
  ['refactor', 'Refactoring'],
  ['docs', 'Documentation'],
]

const REPO = JSON.parse(read('package.json'))
  .repository.url.replace(/^git\+/, '')
  .replace(/\.git$/, '')

function fail(msg) {
  console.error(`error: ${msg}`)
  process.exit(1)
}

// ---------------------------------------------------------------- arguments

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const positional = args.filter((a) => !a.startsWith('--'))
const bump = ['--patch', '--minor', '--major'].find((f) => args.includes(f))?.slice(2)

if (positional.length > 1 || (positional.length === 1 && bump)) {
  fail('give either a version (0.4.0) or one of --patch / --minor / --major')
}

const pkg = JSON.parse(read('package.json'))
const current = pkg.version

function nextVersion() {
  if (positional.length === 1) {
    if (!/^\d+\.\d+\.\d+$/.test(positional[0])) fail(`not a version: ${positional[0]}`)
    return positional[0]
  }
  if (!bump) fail('give a version (0.4.0) or one of --patch / --minor / --major')
  const [maj, min, pat] = current.split('.').map(Number)
  if (bump === 'major') return `${maj + 1}.0.0`
  if (bump === 'minor') return `${maj}.${min + 1}.0`
  return `${maj}.${min}.${pat + 1}`
}

const version = nextVersion()
const tag = `v${version}`

// ------------------------------------------------------------ preconditions

if (!dryRun) {
  if (git('status', '--porcelain')) fail('working tree is dirty — commit or stash first')
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD')
  if (branch !== 'main') fail(`releases are cut from main, not ${branch}`)
}
if (git('tag', '--list', tag)) fail(`tag ${tag} already exists`)

// -------------------------------------------------------------- commit scan

// The previous release tag bounds the range. `--match=v*` so a stray non-release
// tag cannot silently truncate the changelog.
let previousTag = ''
try {
  previousTag = git('describe', '--tags', '--abbrev=0', '--match=v*')
} catch {
  // No tags yet: the first release covers the whole history.
}

const range = previousTag ? `${previousTag}..HEAD` : 'HEAD'

// Every field is NUL-terminated, so records are just groups of three. NUL is
// the one byte a commit message cannot contain; splitting on anything else
// would break on multi-line bodies, which is where BREAKING CHANGE footers
// live.
const NUL = String.fromCharCode(0)
const fields = git('log', range, '--format=%H%x00%s%x00%b%x00')
  .split(NUL)
  .map((f) => f.trim())

const commits = []
for (let i = 0; i + 2 < fields.length; i += 3) {
  const [sha, subject, body] = fields.slice(i, i + 3)
  // type(scope)!: subject — anything else (an unprefixed subject, or the
  // `add:` this project used before adopting the convention) is not a
  // changelog entry and is dropped.
  const m = /^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/.exec(subject)
  if (!m) continue
  const [, type, scope, bang, description] = m
  const breaking = Boolean(bang) || /^BREAKING[ -]CHANGE:/m.test(body)
  commits.push({ sha, type, scope, description, breaking })
}

// ---------------------------------------------------------------- changelog

const shaLink = (sha) => `([${sha.slice(0, 7)}](${REPO}/commit/${sha}))`
const line = (c) => `* ${c.scope ? `**${c.scope}:** ` : ''}${c.description} ${shaLink(c.sha)}`

const heading = previousTag
  ? `## [${version}](${REPO}/compare/${previousTag}...${tag})`
  : `## ${version}`
const date = new Date().toISOString().slice(0, 10)

let entry = `${heading} (${date})\n`

const breaking = commits.filter((c) => c.breaking)
if (breaking.length) {
  entry += `\n\n### ⚠ BREAKING CHANGES\n\n${breaking.map(line).join('\n')}\n`
}

for (const [type, section] of SECTIONS) {
  const matching = commits.filter((c) => c.type === type)
  if (!matching.length) continue
  entry += `\n\n### ${section}\n\n${matching.map(line).join('\n')}\n`
}

if (entry.trim() === `${heading} (${date})`) {
  console.warn(`warning: no user-visible commits since ${previousTag || 'the start'}`)
}

// The entry goes after the file's prose preamble and above the newest existing
// release, which is the first `## ` heading in the file.
const changelog = read('CHANGELOG.md')
const firstRelease = changelog.indexOf('\n## ')
const [preamble, rest] =
  firstRelease === -1
    ? [changelog.replace(/\s*$/, '\n'), '']
    : [changelog.slice(0, firstRelease + 1), changelog.slice(firstRelease + 1)]

const nextChangelog = `${preamble}\n${entry}\n${rest}`

// ------------------------------------------------------- version references

// package-lock.json records the version twice: at the top level and in the
// entry for the root package. `npm version` would keep them in step, but it
// also commits and tags on its own terms, so the edit is done here instead.
const lock = JSON.parse(read('package-lock.json'))
lock.version = version
if (lock.packages?.['']) lock.packages[''].version = version

pkg.version = version

// The README carries a shields.io version badge. The marker comment on that
// line is what makes the substitution unambiguous, so it stays even though
// release-please is gone.
const readme = read('README.md')
const badge = /^(.*message=)(\d+\.\d+\.\d+)(.*<!-- x-release-please-version -->)$/m
if (!badge.test(readme)) fail('README version badge not found — has the marker comment moved?')
const nextReadme = readme.replace(badge, `$1${version}$3`)

// ------------------------------------------------------------------- commit

if (dryRun) {
  console.log(
    `${current} -> ${version} (${tag}), ${commits.length} conventional commits since ${previousTag || 'the start'}\n`,
  )
  console.log(entry)
  process.exit(0)
}

write('CHANGELOG.md', nextChangelog)
write('package.json', `${JSON.stringify(pkg, null, 2)}\n`)
write('package-lock.json', `${JSON.stringify(lock, null, 2)}\n`)
write('README.md', nextReadme)

git('add', 'CHANGELOG.md', 'package.json', 'package-lock.json', 'README.md')
git('commit', '-m', `chore(release): ${version}`)
// Annotated, so `git describe` sees it and the tag carries a date and author.
git('tag', '-a', tag, '-m', tag)

console.log(`Released ${tag} locally. Push it with:\n\n  git push --follow-tags\n`)
