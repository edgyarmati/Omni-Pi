# AGENTS.md

This file provides guidance to Codex and other AI agents when working with code in this repository.

## Commands

- `npm test` — run the test suite (Vitest)
- `npm run check` — TypeScript type-check
- `npm run lint` — Biome lint + format check (use `npm run format` to auto-fix)
- `node ./bin/omni.js` — launch locally in dev mode

## Architecture

Omni-Pi is a batteries-included Pi package built around a single conversational brain.

**Agent flow**: Omni now starts in normal Pi behavior by default. When `/omni-mode` is enabled, one brain interviews the user, writes the spec into `.omni/`, breaks work into bounded slices, implements them, and records verification/results in durable memory.

**Memory**: `.omni/` files hold durable project standards, context, and Omni workflow state — not source code. When Omni mode is off, only the durable standards/context should be treated as active guidance. `.pi/` is Pi-runtime-local state and should stay out of Git.

**Extensions**: Pi loads extensions listed in `package.json` under `pi.extensions`. Custom entrypoints live in `extensions/`. Third-party extensions are referenced via `./node_modules/` paths.

**Bundled extensions** (loaded in order):
- `omni-core` — brain workflow, themed UI, header, shortcuts, updater
- `omni-memory` — `.omni/` durable memory bootstrap
- `pi-web-access` — web search and fetch tools
- `pi-interview` — guided Q&A for clarification
- `pi-extension-settings` — settings persistence
- `pi-powerbar` — powerline-style status bar

**Skills**: Bundled workflow skills live in `skills/`. Pi discovers them via `pi.skills` in `package.json`.
Bundled defaults now include `find-skills`, `skill-creator`, and `brainstorming`, so Omni can discover, create, and use planning-oriented skills without external installation.

## Workflow

Always document plans and progress. Before making changes, state what you intend to do. After completing tasks, summarize what was done.

`/omni-mode` is persistent per project through `.pi/settings.json`.

When Omni mode is off:
- keep the normal Pi behavior
- treat `.omni/PROJECT.md`, `.omni/SPEC.md`, `.omni/DECISIONS.md`, `.omni/CONFIG.md`, `.omni/SKILLS.md`, and `.omni/STANDARDS.md` as passive guidance if present
- ignore `.omni/TASKS.md`, `.omni/STATE.md`, `.omni/TESTS.md`, `.omni/tasks/`, and `.omni/SESSION-SUMMARY.md` for workflow execution

When Omni mode is turned on for a project:
- lazily initialize or migrate `.omni/` on the first real agent turn
- discover external standards files such as `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md`, `.cursor/rules/**/*.mdc`, `.cursorrules`, `.windsurf/rules/**`, and `.continue/rules/**`
- ask the user whether to keep repo-wide standards in Omni's durable config
- automatically install matching task skills into `.omni/project-skills/`, create a project skill when none exists, track skill dependencies per task, and remove project-scoped skills once no open task still depends on them
- ensure `.pi/` is ignored in `.gitignore` when the project is a Git repo

**Commits**: Use conventional commit format (`feat:`, `fix:`, `refactor:`, etc.).

## TypeScript

- ES modules only — NodeNext module resolution, `import.meta.url` for paths. No CommonJS in `src/` or `extensions/`.
- Strict mode enabled. `npm run check` must pass before committing.
- `bin/omni.js` is plain JS (not TypeScript) — the launcher has no compile step.

## Testing

Tests live in `tests/`. Vitest covers the durable planning/implementation workflow and extension wiring.

## Model API Keys

The Pi runtime manages model credentials externally. No API key setup is required in this repo.
