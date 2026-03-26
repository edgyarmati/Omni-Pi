# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Commands

- `npm test` — run the test suite (Vitest)
- `npm run check` — TypeScript type-check
- `npm run lint` — Biome lint + format check (use `npm run format` to auto-fix)
- `node ./bin/omni.js` — launch locally in dev mode
- `npm install -g .` — install the `omni` command globally from the local checkout

## Architecture

Omni-Pi boots the Pi runtime with bundled extensions, skills, agents, and prompts loaded via `-e <path-to-omni-pi>`.

**Agent roles**: Brain (conversational) → Planner (spec/tasks/tests) → Worker (bounded task execution) → Expert (failure recovery after retry threshold)

**Memory**: `.omni/` files hold runtime project state — not source code. They are written and read by Omni-Pi during `omni` sessions.

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

Tests live in `tests/`. Vitest mocks Pi runtime internals — not all behavior is observable without running the real `omni` command.

## Model API Keys

The Pi runtime manages model credentials externally. No API key setup is required in this repo.
