# Omni-Pi OSS Release Design

**Date:** 2026-03-26
**Status:** Draft
**Author:** Eduard-David Gyarmati

---

## Goal

Turn Omni-Pi from a private project into a public open-source package on GitHub (`EdGy2k/Omni-Pi`) and npm (`omni-pi`), with MIT licensing, proper attribution, and contributor infrastructure ready from day one.

## Decisions

- **License:** MIT
- **Target audience:** Beginners (primary), experienced developers (secondary)
- **Repository:** `https://github.com/EdGy2k/Omni-Pi`
- **npm:** Published as `omni-pi`, also installable via git clone
- **Contributions:** Open from launch with full contributor infrastructure
- **Attribution:** Consolidate into a single `CREDITS.md` entry per person/project — no duplicate mentions

---

## 1. LICENSE File

Create `LICENSE` in the repo root with the standard MIT license text.

- Copyright (c) 2026 Eduard-David Gyarmati
- No modifications to the standard MIT text

## 2. Credits & Attribution

Update `CREDITS.md` to be the single canonical attribution file. Changes from current:

- Add `@mariozechner/pi-coding-agent` as a direct dependency credit (currently in package.json but not in CREDITS)
- Consolidate nicobailon entries: merge the `pi-subagents` entry and the broader ecosystem mention into one entry covering both the direct dependency and the ecosystem inspiration
- Remove the duplicated attribution list from `README.md` — replace with a short sentence linking to `CREDITS.md`

### Final CREDITS.md structure

```
# Credits

## Core upstream foundations
- badlogic/pi-mono — Pi runtime, package model, extension system (Mario Zechner + contributors)
- @mariozechner/pi-coding-agent — Pi coding agent package (direct dependency)

## Workflow and orchestration inspiration
- can1357/oh-my-pi — model-role routing, orchestration ideas
- gsd-build/gsd-2 — disk-first workflow state, durable progress files

## Ecosystem inspiration
- nicobailon/pi-subagents — isolated worker/expert execution substrate (direct dependency) and broader subagent/extension ecosystem inspiration (Nico Bailon)
- The broader Pi community — package, skill, and workflow ideas
```

## 3. README Rewrite

Replace the current developer-notes README with a public-facing structure:

### Sections in order

1. **Title + tagline** — "Omni-Pi: Guided software delivery for everyone." One paragraph explaining what it is.

2. **Badges** — MIT license badge, npm version badge, CI status badge (placeholder until CI is set up).

3. **Why Omni-Pi** — 4 bullet value propositions:
   - Guided step-by-step workflow (no blank-canvas paralysis)
   - Durable project memory in `.omni/` (survives sessions)
   - Automatic verification with language-aware test inference
   - Expert fallback when the worker agent gets stuck

4. **Quick Start** — 3 lines:
   ```
   npm install -g omni-pi
   cd your-project
   omni
   ```

5. **Commands** — existing table (already good, keep as-is)

6. **How It Works** — condensed agent pipeline: Brain -> Planner -> Worker -> Expert. 1-2 paragraphs max.

7. **Features** — existing features section, lightly edited for public clarity.

8. **Development** — for contributors: clone, `npm install`, `npm test`, `npm run check`, `npm run lint`. Link to CONTRIBUTING.md.

9. **Attribution** — one sentence: "Omni-Pi builds on the Pi ecosystem. See [CREDITS.md](CREDITS.md) for full attribution."

10. **License** — "MIT. See [LICENSE](LICENSE)."

### Content removed from README
- The detailed "Install from tarball" flow (moves to CONTRIBUTING.md)
- The "Update" section (moves to CONTRIBUTING.md or wiki)
- Internal dev notes (covered by CLAUDE.md, not public-facing)

## 4. Contributor Infrastructure

### CONTRIBUTING.md

Sections:
- **Getting Started** — clone, install, run locally (`node ./bin/omni.js`)
- **Development Commands** — `npm test`, `npm run check`, `npm run lint`, `npm run format`
- **Code Standards** — Biome for linting/formatting, strict TypeScript, ES modules only, no CommonJS
- **Testing** — tests in `tests/`, Vitest, run before submitting
- **Commit Messages** — conventional commits (`feat:`, `fix:`, `refactor:`, etc.)
- **Pull Request Process** — fork, branch, make changes, ensure tests/types/lint pass, open PR with description
- **Installing from source** — `npm install -g .` for the branded `omni` command, `npm pack` flow for tarball installs

### CODE_OF_CONDUCT.md

Contributor Covenant v2.1 (standard, widely adopted). Contact email: link to GitHub profile or a dedicated email if the author provides one.

### GitHub Issue Templates

`.github/ISSUE_TEMPLATE/bug_report.md`:
- Steps to reproduce
- Expected behavior
- Actual behavior
- Environment (OS, Node version, Pi version)

`.github/ISSUE_TEMPLATE/feature_request.md`:
- Problem description
- Proposed solution
- Alternatives considered

### PR Template

`.github/PULL_REQUEST_TEMPLATE.md`:
- What does this PR do?
- Checklist: tests pass, types pass, lint clean, conventional commit message

## 5. package.json Changes

```diff
- "private": true,
+ "license": "MIT",
+ "author": "Eduard-David Gyarmati",
+ "repository": {
+   "type": "git",
+   "url": "https://github.com/EdGy2k/Omni-Pi.git"
+ },
+ "homepage": "https://github.com/EdGy2k/Omni-Pi#readme",
+ "bugs": {
+   "url": "https://github.com/EdGy2k/Omni-Pi/issues"
+ },
```

Remove `"private": true` to allow npm publish.

## 6. .gitignore Hardening

Add these entries to prevent accidental leaks or noise:

```
.env
.env.*
*.log
.pi/
Thumbs.db
*.swp
*.swo
```

`.pi/` is runtime-generated per-project (like `.omni/`), should not be committed.

## Out of Scope

- CI/CD pipeline setup (GitHub Actions) — important but separate effort
- npm publish automation — manual `npm publish` for v0.1.0
- Changelog generation — can add `CHANGELOG.md` later
- Branch protection rules — configure on GitHub after repo is public
- Backlog items from `docs/BACKLOG.md` — those are functional improvements, not OSS readiness

## File Checklist

| File | Action |
|------|--------|
| `LICENSE` | Create (MIT) |
| `CREDITS.md` | Update (consolidate, add pi-coding-agent) |
| `README.md` | Rewrite (public-facing) |
| `CONTRIBUTING.md` | Create |
| `CODE_OF_CONDUCT.md` | Create (Contributor Covenant v2.1) |
| `.github/ISSUE_TEMPLATE/bug_report.md` | Create |
| `.github/ISSUE_TEMPLATE/feature_request.md` | Create |
| `.github/PULL_REQUEST_TEMPLATE.md` | Create |
| `package.json` | Update (remove private, add metadata) |
| `.gitignore` | Update (add safety entries) |
