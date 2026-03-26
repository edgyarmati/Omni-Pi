# Omni-Pi

Omni-Pi: Guided software delivery for everyone.

Omni-Pi is an opinionated Pi package and branded launcher published on npm as `omni-pi`. It helps people move from a blank repo to a structured plan, implemented work, and explicit verification without having to assemble the workflow themselves.

Requires Node.js 22 or newer.

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/omni-pi.svg)](https://www.npmjs.com/package/omni-pi)
[![CI](https://github.com/EdGy2k/Omni-Pi/actions/workflows/ci.yml/badge.svg)](https://github.com/EdGy2k/Omni-Pi/actions/workflows/ci.yml)

## Why Omni-Pi

- Guided step-by-step workflow keeps the process moving without blank-canvas paralysis.
- Durable project memory in `.omni/` survives across sessions.
- Automatic verification infers checks from the language and project shape.
- Expert fallback takes over when the worker agent gets stuck.

## Quick Start

Install the published package, then run it in your project:

```bash
npm install -g omni-pi
cd your-project
omni
```

## Commands

| Command | Description |
|---------|-------------|
| `/omni-init` | Initialize `.omni/` project memory, run quick-start wizard, scan repo signals, run health checks (`--quick` to skip wizard) |
| `/omni-plan` | Create or refresh spec, tasks, and tests (supports `--preset bugfix/feature/refactor/spike/security-audit`) |
| `/omni-work` | Run the next task through worker, verifier, and expert fallback |
| `/omni-status` | Show current phase, task, blockers, next step (add `metrics` for agent stats) |
| `/omni-sync` | Update durable memory files from recent progress |
| `/omni-skills` | Inspect installed, recommended, deferred, and rejected skills |
| `/omni-explain` | Explain what Omni-Pi is doing in simple language |
| `/omni-model` | Interactively select the model for a specific agent role |
| `/omni-commit` | Create a branch and commit for the last completed task |
| `/omni-doctor` | Run diagnostic health checks and detect stuck tasks |

## How It Works

Omni-Pi follows a simple agent pipeline: Brain, Planner, Worker, Expert. The Brain handles conversation, the Planner turns intent into concrete steps and checks, and the Worker executes bounded tasks with filesystem-backed state in `.omni/`.

When the Worker gets stuck or verification fails repeatedly, the Expert role steps in to recover the task, adapt the approach, or surface the blocker clearly instead of letting the session stall.

## Features

- Core workflow with durable `.omni/` project memory, typed planning and execution contracts, filesystem-backed init/planning/status, and retry-aware task execution.
- Language-aware verification that infers test commands for common stacks and supports custom checks in `.omni/TESTS.md`.
- Workflow presets for bugfix, feature, refactor, spike, and security-audit work.
- Doctor checks for init state, config validity, repo signals, task health, and stuck detection.
- Plan and progress memory with dated plan files, an index tracker, and timestamped progress logs.
- Context-aware file selection for different workflow phases.
- Subagent integration for worker and expert execution with raw output persistence and model overrides.
- Persistent dashboard state for phase, task, blockers, next step, and health status.
- Git integration for branch creation and task-derived commits.
- Interactive planning for constraints, user context, and skill install tracking.

## Development

For local checkout development, see [CONTRIBUTING.md](CONTRIBUTING.md).

```bash
git clone https://github.com/EdGy2k/Omni-Pi.git
cd Omni-Pi
npm install
npm test
npm run check
npm run lint
```

## Attribution

Omni-Pi builds on the Pi ecosystem. See [CREDITS.md](CREDITS.md) for full attribution.

## License

MIT. See [LICENSE](LICENSE).
