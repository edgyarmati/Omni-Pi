# Omni-Pi

Omni-Pi is an opinionated Pi package and branded launcher for guided software delivery.

It is designed to feel simple for beginners while still using a stronger planning model, focused worker subagents, explicit verification, and expert fallback behind the scenes.

## Attribution

Omni-Pi builds on top of the Pi ecosystem and intentionally borrows ideas from earlier community work.

- Pi runtime and package model: [badlogic/pi-mono](https://github.com/badlogic/pi-mono) by Mario Zechner and contributors
- orchestration and workflow inspiration: [can1357/oh-my-pi](https://github.com/can1357/oh-my-pi)
- disk-first guided workflow inspiration: [gsd-build/gsd-2](https://github.com/gsd-build/gsd-2)
- subagent and Pi ecosystem inspiration: nicopreme/nicobailon packages and related Pi community extensions
- isolated worker/expert execution substrate: [nicobailon/pi-subagents](https://github.com/nicobailon/pi-subagents)

The goal of Omni-Pi is to contribute a distinct, beginner-friendly, opinionated package back into that ecosystem while giving clear credit to the original authors and projects that made it possible.

For a more structured list, see `CREDITS.md`.

## v1 goals

- launch through an `omni` command with Pi batteries included
- guided step mode only
- durable project memory in `.omni/`
- small task slices with explicit done criteria
- automatic skill discovery and routing
- plain-English status updates

## Launch model

- install Omni-Pi
- run `omni`
- Omni-Pi boots the Pi runtime and loads this package with `-e <path-to-omni-pi>` so the bundled Omni extensions, skills, and prompts are available immediately

## Install

From this repo for local development:

```bash
npm install
node ./bin/omni.js
```

To install the branded `omni` command globally from the local package without `npm link`:

```bash
npm pack
npm install -g ./omni-pi-0.1.0.tgz
omni
```

You can also install directly from the repo checkout:

```bash
npm install -g .
omni
```

## Update

Updating is straightforward.

- if you installed from a local checkout, run `npm install -g .` again from the updated repo
- if you installed from a tarball, run `npm pack` again and then `npm install -g ./omni-pi-0.1.0.tgz`
- once published later, this becomes the normal `npm install -g omni-pi@latest`

So no, it is not hard to update the package.

## Demo flow

In a fresh repo or empty folder:

```bash
omni --mode json --no-session "/omni-init"
omni --mode json --no-session "/omni-plan Build a tiny demo feature"
omni --mode json --no-session "/omni-status"
omni --mode json --no-session "/omni-work"
```

What to point out in the demo:

- `.omni/` is created with durable project memory files
- `.pi/agents/` is created with Omni worker and expert agent definitions
- `omni-plan` writes `SPEC.md`, `TASKS.md`, and `TESTS.md`
- `omni-work` routes through isolated worker/expert execution and persists artifacts in `.omni/tasks/`
- runtime verification runs checks from `.omni/TESTS.md` and drives retry or escalation

For an interactive walkthrough, just run:

```bash
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

## Repository layout

- `PLAN.md` - product and implementation plan
- `templates/omni/` - starter `.omni/` files
- `src/` - shared data model and helpers
- `extensions/` - Pi-facing extension scaffolding
- `agents/` - role definitions for brain, planner, worker, expert
- `skills/` - bundled workflow skills
- `prompts/` - prompt templates for brainstorming and planning

## Features

**Core workflow**: Durable `.omni/` project memory, typed contracts for planning/execution/verification/escalation, filesystem-backed init/planning/status, task execution with retry tracking and expert fallback.

**Language-agnostic verification**: Infers test commands for TypeScript, Python, Rust, Go, Ruby, PHP. Supports custom checks in `.omni/TESTS.md`. Runnable command allowlist covers npm, cargo, go, pytest, composer, bundle, make, and more.

**Workflow presets**: `--preset bugfix/feature/refactor/spike/security-audit` configures task shape, verification depth, and interview flow. Auto-detected from branch names and brief text.

**Doctor system**: `/omni-doctor` checks init state, config validity, repo signals, task health, and stuck detection. Runs automatically during `/omni-init`. Dashboard widget shows traffic-light health indicator.

**Plan & progress memory**: Each `/omni-plan` creates a dated plan file in `.omni/plans/` with an `INDEX.md` tracker. `.omni/PROGRESS.md` logs timestamped progress entries. Optional auto-cleanup of completed plans via config.

**Context engineering**: Char-based token budgets (4 chars ≈ 1 token). Phase-aware file selection loads different `.omni/` files for understand/plan/build/check/escalate phases. Pre-reads context directly into worker/expert prompts.

**Subagent integration**: Worker/expert execution via `pi-subagents` with raw output persistence, runtime verification, skill trigger matching, session branching, chain execution mode (scout → worker), and model overrides per agent role.

**Dashboard**: Persistent widget showing phase bar, active task, blockers, next step, and health status. Auto-updates on session start, switch, and turn end.

**Git integration**: `/omni-commit` creates branches, stages files, and commits with task-derived messages.

**Interactive planning**: Refinement prompts for constraints and user context with plan approval confirmation. Skill install tracking with deferred recovery.

## Development

- `npm test` - run the automated test suite
- `npm run check` - type-check the TypeScript code
- `node ./bin/omni.js --help` - launch the bundled Pi runtime through Omni-Pi

## Next steps

- full end-to-end demo with real subagent execution against a live codebase
- parallel task execution for independent tasks with bounded concurrency
- PR creation and review support with follow-up task capture
- better token estimation (model-aware tokenizer)
- web dashboard for progress visualization

See `docs/BACKLOG.md` for the complete backlog.
