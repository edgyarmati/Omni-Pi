# AGENTS.md

This file provides guidance to Codex and other AI agents when working with code in this repository.

## Commands

- `npm test` — run the test suite (Vitest)
- `npm run check` — TypeScript type-check
- `npm run lint` — Biome lint + format check (use `npm run format` to auto-fix)
- `node ./bin/omni.js` — launch locally in dev mode

## Architecture

Omni-Pi is a batteries-included Pi package built around a single conversational brain.

**Agent flow**: one brain interviews the user, writes the spec into `.omni/`, breaks work into bounded slices, implements them, and records verification/results in durable memory.

**Memory**: `.omni/` files hold runtime project state — not source code. They are written and read during planning, implementation, and verification.

**Extensions**: Pi loads extensions listed in `package.json` under `pi.extensions`. Custom entrypoints live in `extensions/`. Third-party extensions are referenced via `./node_modules/` paths.

**Bundled extensions** (loaded in order):
- `omni-providers` — model provider wiring
- `omni-core` — brain workflow, themed UI, header, shortcuts, updater
- `omni-memory` — `.omni/` durable memory bootstrap
- `pi-web-access` — web search and fetch tools
- `pi-interview` — guided Q&A for clarification
- `pi-extension-settings` — settings persistence
- `pi-powerbar` — powerline-style status bar

**Skills**: Bundled workflow skills live in `skills/`. Pi discovers them via `pi.skills` in `package.json`.

## Workflow

Always document plans and progress. Before making changes, state what you intend to do. After completing tasks, summarize what was done.

**Commits**: Use conventional commit format (`feat:`, `fix:`, `refactor:`, etc.).

## TypeScript

- ES modules only — NodeNext module resolution, `import.meta.url` for paths. No CommonJS in `src/` or `extensions/`.
- Strict mode enabled. `npm run check` must pass before committing.
- `bin/omni.js` is plain JS (not TypeScript) — the launcher has no compile step.

## Testing

Tests live in `tests/`. Vitest covers the durable planning/implementation workflow and extension wiring.

## Model API Keys

The Pi runtime manages model credentials externally. No API key setup is required in this repo.
