# Omni-Pi

A batteries-included [Pi](https://github.com/badlogic/pi-mono) package with an opt-in Omni workflow for interviewing, documenting the spec, and implementing work in bounded slices.

Requires Node.js 22 or newer.

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/omni-pi.svg)](https://www.npmjs.com/package/omni-pi)
[![CI](https://github.com/EdGy2k/Omni-Pi/actions/workflows/ci.yml/badge.svg)](https://github.com/EdGy2k/Omni-Pi/actions/workflows/ci.yml)

## What It Does

- Starts in normal Pi behavior with an opinionated setup.
- `/omni-mode` turns on Omni's specialized interview, plan, build, and verify workflow for the current project.
- Keeps durable standards and project context in `.omni/`, even when Omni mode is off.
- Writes specs, tasks, and progress into `.omni/` once Omni mode is enabled.
- Adds a repo map that indexes supported source files, ranks them by structure plus recent activity, and injects a compact codebase-awareness block into Omni prompts.
- Bundles web search, guided interviews, themed UI, native micro-UI via Glimpse, a task viewer, a powerbar, custom provider/model management, and automatic updates out of the box.
- Now also includes an in-repo migration track toward a standalone Omni app with an Omni-owned OpenTUI shell backed by Pi over RPC.

## Install

```bash
npm install -g omni-pi
```

Then run it in any project:

```bash
cd your-project
omni
```

To try the standalone OpenTUI shell without replacing the main `omni` command yet:

```bash
cd your-project
omni-standalone
```

Notes:
- `omni` still launches the package-first Pi-based experience
- `omni-standalone` launches the standalone Omni shell backed by Pi RPC
- the standalone shell currently requires Bun at runtime in this repo because of an OpenTUI asset-loading issue under plain Node

Custom provider setup, refresh behavior, and bundled provider behavior are documented in [PROVIDERS.md](PROVIDERS.md).

## Features

### Bundled Skills

Omni-Pi now ships the essential skill-discovery stack in the package itself:

- `find-skills` is bundled for discovering relevant skills
- `skill-creator` is bundled for creating project-specific skills when nothing suitable exists
- `brainstorming` is bundled and used for Omni planning and task creation flows

### Repo Map

Omni-Pi now includes a SoulForge-style repo map for codebase awareness while Omni mode is on.

The first shipped version includes:

- incremental indexing of supported repo files while respecting `.gitignore`
- symbol/import extraction for TypeScript/JavaScript-family files with graceful fallback for partial/unsupported cases
- graph-aware ranking blended with current-turn boosts from recent reads, edits, writes, and prompt mentions
- budget-aware prompt rendering so Omni gets a compact ranked view of important files and exported symbols
- runtime cache storage under `.pi/repo-map/` rather than durable `.omni/` memory

Current deferred roadmap items remain intentional and visible in docs rather than hidden in code:

- semantic symbol summaries
- git co-change ranking
- richer analysis views such as dead-code or clone-detection signals
- broader parser/language coverage as needed

### Bundled Extensions

| Extension | What it does |
|-----------|-------------|
| **omni-core** | Brain workflow, themed header, session init, system prompt injection |
| **omni-providers** | Model provider wiring |
| **omni-memory** | `.omni/` durable memory bootstrap |
| **glimpseui** | Native micro-UI windows and the optional floating companion widget |
| **pi-web-access** | Web search and fetch tools for the agent |
| **pi-interview** | Guided Q&A when the agent needs clarification |
| **pi-powerbar** | Powerline-style status bar with segments |
| **pi-extension-settings** | Settings persistence for extensions |

### Native Micro-UI

Omni-Pi now bundles [Glimpse](https://github.com/HazAT/glimpse) for native micro-UI windows:

- the bundled `glimpse` skill lets the agent open native dialogs, forms, previews, and other rich UI when a task benefits from it
- the `/companion` command toggles an optional floating status pill that follows the cursor and reflects live agent activity
- the companion is optional; Glimpse-backed windows remain available even when the floating widget is disabled

### Commands

| Command | Description |
|---------|-------------|
| `/model-setup` | Add, refresh, or remove custom provider/model entries |
| `/manage-providers` | Remove stored auth for bundled providers |
| `/omni-mode` | Toggle persistent Omni mode on or off for this project |
| `/companion` | Toggle the Glimpse floating companion widget |
| `/theme` | Switch between color presets (lavender, ember, ocean, mint, rose, gold, arctic, neon, copper, slate) |
| `/update` | Check for Omni-Pi updates |

### Keyboard Shortcuts

| Shortcut | Description |
|----------|-------------|
| `Ctrl+Shift+T` | Toggle the task list widget (`.omni/TASKS.md` + `.omni/STATE.md`) |

### Auto-Updater

Omni-Pi checks for new versions on startup (cached, re-checks every 4 hours). When an update is available, it prompts to install and restart. Pi's own update notification is suppressed to avoid duplication.

## Provider Support

`/model-setup` is for custom providers and custom model entries only.

Use `/model-setup` when you want to configure:

- a custom provider id
- an API type and base URL
- an API key for that custom provider
- discovered models or manual model entries
- a manual refresh of already configured custom providers

Use `/manage-providers` to remove stored auth for bundled Pi providers.

Anthropic is intentionally API-key-only in Omni-Pi. Anthropic OAuth login is disabled.

See [PROVIDERS.md](PROVIDERS.md) for the current supported-provider list and auth-management split.

## Omni Mode

Omni-Pi keeps its current branding and shell at all times, but the specialized workflow is opt-in.

- When Omni mode is off, Omni behaves like normal Pi and only uses `.omni/` as passive standards/context when those files already exist.
- When Omni mode is on, Omni lazily initializes or migrates `.omni/` on the first real turn, then uses the full interview, planning, task, and verification workflow.
- While Omni mode is on, Omni also maintains a runtime repo map in `.pi/repo-map/` so prompts can include a compact ranked view of important files and symbols.
- During Omni init, Omni can discover standards from files like `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, Copilot instructions, Cursor rules, Windsurf rules, and Continue rules, then ask whether to keep those standards in Omni's durable memory.
- In Git repos, Omni ensures `.pi/` is ignored because that directory is only runtime-local Pi state.
- While Omni mode is on, every planned or executed task checks for required skills, auto-installs matching skills into `.omni/project-skills/`, creates a project skill when none exists, records task-to-skill dependencies, and removes project skills once no open task still needs them.

## Durable Memory

Omni-Pi keeps its working notes in `.omni/`:

| File | Purpose |
|------|---------|
| `PROJECT.md` | Problem, users, constraints, success criteria |
| `STANDARDS.md` | Imported standards accepted from other harness instruction files |
| `project-skills/` | Project-scoped skills auto-installed or created for active tasks |
| `SPEC.md` | Exact requested behavior and implementation shape |
| `TASKS.md` | Work broken into bounded slices |
| `TESTS.md` | Checks for the current slice |
| `STATE.md` | Current phase, active task, blockers |
| `SESSION-SUMMARY.md` | Progress notes across sessions |
| `DECISIONS.md` | Rationale for key choices |
| `VERSION` | Current `.omni/` standard version |

## Standalone app migration

On branch `feat/opentui-standalone-omni`, Omni is being migrated toward a standalone terminal app that owns its UI instead of inheriting Pi's built-in TUI.

The planned architecture is:

- **UI shell:** OpenTUI (Omni-owned layout, panels, and interactions)
- **Engine:** Pi running in **RPC mode** as a subprocess
- **Migration policy:** keep the current Pi-package path runnable while the standalone app reaches parity

Today the repo includes an early standalone preview command:

```bash
npm run chat:standalone
# or, after global install when Bun is available:
omni-standalone
```

Current migration caveats:

- the legacy `omni` command still launches the existing Pi-package UI path
- the standalone preview currently uses **Bun** to run the OpenTUI shell because OpenTUI's Node integration is not yet clean enough for this repo's runtime path
- the standalone shell already supports prompting, streaming conversation updates, abort, queue visibility, workflow/repo-map side panels, and basic slash-command controls for model/session actions

The active migration contract and target package layout live in [`docs/architecture/standalone-app.md`](docs/architecture/standalone-app.md).

## Development

```bash
git clone https://github.com/EdGy2k/Omni-Pi.git
cd Omni-Pi
npm install
npm run chat    # launch locally in dev mode
```

| Command | Purpose |
|---------|---------|
| `npm run chat` | Launch the local `omni` executable |
| `npm test` | Run the test suite (Vitest) |
| `npm run check` | TypeScript type-check |
| `npm run lint` | Biome lint + format check |
| `npm run verify` | Full local/CI gate: type-check, lint, test, and package dry-run |
| `npm run format` | Auto-fix lint and formatting |
| `npm install -g .` | Install globally from local checkout |

## CI/CD

- Pull requests and pushes to `main` run `npm run verify`.
- The docs are part of the test contract, including a sync check between `PROVIDERS.md` and the bundled-provider setup list in code.
- Pushing a `v*` tag runs the release workflow, verifies the repo again, publishes to npm through GitHub Actions trusted publishing with provenance, and then creates the GitHub release.
- Trusted publishing still requires npm-side setup for this repository/workflow in the npm package settings.

## Attribution

Omni-Pi builds on the Pi ecosystem. See [CREDITS.md](CREDITS.md).

## License

MIT. See [LICENSE](LICENSE).
