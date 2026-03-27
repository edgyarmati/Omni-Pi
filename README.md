# Omni-Pi

A batteries-included [Pi](https://github.com/badlogic/pi-mono) package that interviews the user, documents the spec, and implements work in bounded slices.

Requires Node.js 22 or newer.

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/omni-pi.svg)](https://www.npmjs.com/package/omni-pi)
[![CI](https://github.com/EdGy2k/Omni-Pi/actions/workflows/ci.yml/badge.svg)](https://github.com/EdGy2k/Omni-Pi/actions/workflows/ci.yml)

## What It Does

- One conversational brain interviews the user until the request is precise.
- Writes specs, tasks, and progress into `.omni/` as durable project memory.
- Breaks work into small, verifiable slices and implements them one at a time.
- Bundles web search, guided interviews, themed UI, a task viewer, a powerbar, custom provider/model management, and automatic updates out of the box.

## Install

```bash
npm install -g omni-pi
```

Then run it in any project:

```bash
cd your-project
omni
```

Custom provider setup and bundled provider behavior are documented in [PROVIDERS.md](PROVIDERS.md).

## Features

### Bundled Extensions

| Extension | What it does |
|-----------|-------------|
| **omni-core** | Brain workflow, themed header, session init, system prompt injection |
| **omni-providers** | Model provider wiring |
| **omni-memory** | `.omni/` durable memory bootstrap |
| **pi-web-access** | Web search and fetch tools for the agent |
| **pi-interview** | Guided Q&A when the agent needs clarification |
| **pi-powerbar** | Powerline-style status bar with segments |
| **pi-extension-settings** | Settings persistence for extensions |

### Commands

| Command | Description |
|---------|-------------|
| `/model-setup` | Add, list, or remove custom providers and models |
| `/provider-auth` | Remove stored auth for bundled providers |
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

Use it when you want to configure:

- a custom provider id
- an API type and base URL
- an API key for that custom provider
- discovered models or manual model entries

Use `/provider-auth` to remove stored auth for bundled Pi providers.

See [PROVIDERS.md](PROVIDERS.md) for the current supported-provider list and auth-management split.

## Durable Memory

Omni-Pi keeps its working notes in `.omni/`:

| File | Purpose |
|------|---------|
| `PROJECT.md` | Problem, users, constraints, success criteria |
| `SPEC.md` | Exact requested behavior and implementation shape |
| `TASKS.md` | Work broken into bounded slices |
| `TESTS.md` | Checks for the current slice |
| `STATE.md` | Current phase, active task, blockers |
| `SESSION-SUMMARY.md` | Progress notes across sessions |
| `DECISIONS.md` | Rationale for key choices |

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
| `npm run format` | Auto-fix lint and formatting |
| `npm install -g .` | Install globally from local checkout |

## Attribution

Omni-Pi builds on the Pi ecosystem. See [CREDITS.md](CREDITS.md).

## License

MIT. See [LICENSE](LICENSE).
