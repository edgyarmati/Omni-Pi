# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm test` — run the test suite (Vitest)
- `npm run check` — TypeScript type-check
- `npm run lint` — Biome lint + format check (use `npm run format` to auto-fix)
- `node ./bin/omni.js` — launch locally in dev mode
- `npm install -g .` — install the `omni` command globally from the local checkout

## Architecture

Omni-Pi is currently being simplified around a single user-facing brain.

**Agent flow**: one conversational brain interviews the user, writes the exact spec into `.omni/`, breaks the work into bounded slices, implements them, and records verification/results in durable memory.

**Memory**: `.omni/` files hold runtime project state — not source code. They are written and read during planning, implementation, and verification.

**Extensions**: Pi loads extensions listed in `package.json` under `pi.extensions`. Entrypoints live in `extensions/`.

**Skills**: Bundled workflow skills live in `skills/`. Pi discovers them via `pi.skills` in `package.json`.

## Workflow

Always document plans and progress. Before making changes, state what you intend to do. After completing tasks, summarize what was done.

**Commits**: After implementing a feature or completing a phase, create a git commit to snapshot the work. This keeps history clean and makes it easy to revert or track changes. Use conventional commit format (`feat:`, `fix:`, `refactor:`, etc.).

## TypeScript

- ES modules only — NodeNext module resolution, `import.meta.url` for paths. No CommonJS in `src/` or `extensions/`.
- Strict mode enabled. `npm run check` must pass before committing.
- `bin/omni.js` is plain JS (not TypeScript) — the launcher has no compile step.

## Testing

Tests live in `tests/`. Vitest covers the durable planning/implementation workflow and extension wiring.

## Model API Keys

The Pi runtime manages model credentials externally. No API key setup is required in this repo.
