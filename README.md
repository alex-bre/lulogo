<p align="center">
  <img src="public/lulogo-logo.svg" width="160" alt="Lulogo">
</p>

<p align="center">
  A vector editor that runs in your browser.<br>
</p>

<p align="center">
  <a href="https://alex-bre.github.io/lulogo/"><strong>Open the editor →</strong></a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/licence-AGPL--3.0--only-blue" alt="Licence: AGPL-3.0-only"></a>
  <a href="CHANGELOG.md"><img src="https://img.shields.io/static/v1?label=version&message=0.4.0&color=blue" alt="Version"></a>
</p>

---

## Features

- **Draw** 
  - Shape primitives, 
  - Pen tool and point-level path editing
- **Combine**
  - Boolean operations: union, subtract, intersect, and exclude
  - Convex hull
  - Corner rounding
- **Type**
  - Convert text to paths whenever you want
- **Transform in 3D**
  - Isometric, orthographic, and perspective projections
- **Organise**
  - Layers with grouping
  - Grid and object snapping with placement guides
- **Animate**
  - keyframe the canvas and export an animated SVG
- **Export**
  - SVG (whole page or selection only) and PNG
  - Optimisation pass you can tune
  - Project file `.lulogo.json`
  - Import SVGs and images

## Running it locally

```bash
npm install
npm run dev        # dev server with HMR
npm test           # test suite, single run
npm run build      # static build into dist/
npm run preview    # serve that build locally
```

Node 22 or newer.

## Releases and deployment

Two workflows, each with a single trigger.

**The site** redeploys on every push to `main` — `.github/workflows/pages.yml`
tests, builds, and publishes `dist/` to
[GitHub Pages](https://alex-bre.github.io/lulogo/). Merging is the whole
deployment procedure; there is nothing to run by hand. Pages is configured
with *Settings → Pages → Source: GitHub Actions*, which is a one-time setting.

**A release** is cut locally and published by its tag:

```bash
npm run release -- --minor      # or --patch / --major / an explicit 0.5.0
npm run release -- --minor --dry-run   # see the changelog entry first
```

That writes the CHANGELOG entry, bumps the version in `package.json`,
`package-lock.json` and the README badge, commits, and tags — all locally,
nothing pushed. Review the commit, then:

```bash
git push --follow-tags
```

The tag is what publishes: `.github/workflows/release.yml` runs on `v*`,
builds, and creates the GitHub Release with that version's CHANGELOG entry as
the notes and the static build attached as a zip. The same push also updates
`main`, so the site redeploys at the same time.

Only conventional-commit subjects (`feat:`, `fix:`, `perf:`, `revert:`,
`refactor:`, `docs:`) reach the changelog; `chore:`, `ci:` and `test:` are
deliberately left out.

## Self-hosting

The build output is a folder of static files — put `dist/` behind any web
server. `base` is `'./'`, so it works from a domain root, a sub-path, or even
`file://`, and there is no client-side router, so no SPA fallback rewrite is
needed.

Two caching notes: `dist/assets/*` carry a content hash and can be cached
forever, but `dist/fonts/*` keep stable filenames and must **not** be, or a
swapped font stays masked by stale caches.

A two-stage Dockerfile is included — the final image is nginx and the static
files, no Node:

```bash
docker compose up -d --build     # http://localhost:8080
```

It serves plain HTTP; put a reverse proxy in front for TLS.

## Licence

**GNU Affero General Public License v3.0 only** — see [LICENSE](LICENSE).

The clause worth knowing about is §13: if you modify Lulogo and let other people
use your version *over a network*, you have to offer those users its source.
Self-hosting an unmodified copy carries no such obligation. The practical way to
comply with a public fork is a visible source link inside the app — which is
what the About dialog already does.

The licence covers the code. It grants no rights to the Lulogo name or logo.

### Fonts

Every face in [`public/fonts`](public/fonts) is under the SIL Open Font License
1.1, with each licence text shipped beside it in
[`public/fonts/licenses/`](public/fonts/licenses). Those files are part of the
build deliberately: the OFL requires the licence to travel with the font, and
this app both serves the fonts and outlines their glyphs into your exports.

A font can therefore only be added here if its licence permits redistribution
*and* outlining without a per-site agreement — which rules out most commercial
faces even with a paid webfont licence. See
[`public/fonts/NOTICE.txt`](public/fonts/NOTICE.txt).

### Bundled libraries

Listed with their copyright notices in
[THIRD-PARTY-NOTICES](THIRD-PARTY-NOTICES), which ships with the build because
the MIT and ISC terms require it and minified output carries none. Regenerate
after any dependency change with `npm run notices`.
