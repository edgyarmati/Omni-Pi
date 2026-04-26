# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm test` — run the test suite (Vitest)
- `npm run check` — TypeScript type-check
- `npm run lint` — Biome lint + format check (use `npm run format` to auto-fix)
- `node ./bin/omni.js` — launch locally in dev mode
- `npm install -g .` — install the `omni` command globally from the local checkout

## Architecture

Omni-Pi is a batteries-included Pi package built around a single conversational brain.

**Agent flow**: one brain interviews the user, writes the spec into `.omni/`, breaks work into bounded slices, implements them, and records verification/results in durable memory.

**Memory**: `.omni/` files hold runtime project state — not source code. They are written and read during planning, implementation, and verification.

**Extensions**: Pi loads extensions listed in `package.json` under `pi.extensions`. Custom entrypoints live in `extensions/`. Third-party extensions are referenced via `./node_modules/` paths.

**Bundled extensions** (loaded in order):
- `omni-core` — brain workflow, themed UI, header, shortcuts, updater
- `omni-memory` — `.omni/` durable memory bootstrap
- `glimpseui` — native micro-UI windows and floating companion widget
- `pi-web-access` — web search and fetch tools
- `pi-interview` — guided Q&A for clarification
- `pi-diff-review` — diff review surface
- `pi-prompt-template-model` — prompt template / model wiring
- `pi-extension-settings` — settings persistence
- `pi-powerbar` — powerline-style status bar

**Skills**: Bundled workflow skills live in `skills/`. Pi discovers them via `pi.skills` in `package.json`.

**Key source files**:
- `src/brain.ts` — brain system prompt and `.omni/` initialization
- `src/header.ts` — ASCII logo and welcome messages
- `src/theme.ts` — color presets, ANSI helpers, theme constructor
- `src/todo-shortcut.ts` — Ctrl+Shift+T task list widget
- `src/updater.ts` — auto-update checker for omni-pi
- `src/theme-command.ts` — `/theme` command
- `src/pi.ts` — message renderers and command registration

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
