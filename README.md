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

## Planned commands

- `/omni-init` - initialize `.omni/` and analyze the project
- `/omni-status` - explain current state and next step
- `/omni-plan` - create or refresh spec, tasks, and tests
- `/omni-work` - run the next task through worker, verifier, and expert fallback
- `/omni-sync` - update durable memory files from recent progress
- `/omni-skills` - inspect installed and recommended skills
- `/omni-explain` - explain what Omni-Pi is doing in simple language
- `/omni-model` - interactively select the model for a specific agent role
- `/omni-commit` - create a branch and commit for the last completed task

## Repository layout

- `PLAN.md` - product and implementation plan
- `templates/omni/` - starter `.omni/` files
- `src/` - shared data model and helpers
- `extensions/` - Pi-facing extension scaffolding
- `agents/` - role definitions for brain, planner, worker, expert
- `skills/` - bundled workflow skills
- `prompts/` - prompt templates for brainstorming and planning

## Current state

This repository now contains a tested v1 foundation:

- durable `.omni/` starter templates
- typed contracts for planning, execution, verification, and escalation
- filesystem-backed init, planning, and status core logic
- task execution state machine with retry tracking, task briefs, and expert escalation scaffolding
- skill registry parsing, install planning, and persistent usage notes in `.omni/SKILLS.md`
- sync support that writes recent progress back into durable memory files
- command registration scaffolding for `/omni-init`, `/omni-plan`, `/omni-status`, `/omni-sync`, `/omni-skills`, and `/omni-explain`
- a branded `omni` launcher in `bin/omni.js` that boots the Pi runtime with Omni-Pi resources loaded
- real Pi extension entrypoints that register Omni commands through Pi's `ExtensionAPI`
- `/omni-init` can execute planned skill-install commands through Pi's runtime when launched inside `omni`
- `/omni-work` uses `pi-subagents` as the isolated worker/expert execution substrate when available, while Omni-Pi keeps orchestration and memory ownership
- `pi-subagents` runs now persist raw outputs and per-attempt metadata into `.omni/tasks/`
- live runtime verification now executes runnable commands from `.omni/TESTS.md` and uses those results for retry/escalation decisions
- task-specific verification now selects only relevant checks when `.omni/TESTS.md` includes targeted commands or expectations
- expert escalation tracks modified files from worker attempts and surfaces recovery options on failure
- Pi-native message renderers for verification results, status summaries, and escalation notices
- planning incorporates existing decisions, session notes, and prior scope from `.omni/` memory files
- skill install failures are tracked and failed skills are moved to the deferred section with recovery guidance
- task-level verification infers test commands from context files and includes done criteria as expectations
- persistent dashboard widget via `setWidget` in the `omni-memory` extension, auto-updating on session start, switch, and turn end
- run history integration with `/omni-status metrics` rendering success rates and durations
- interactive planning refinement prompts for constraints and user context, with plan approval confirmation
- skill trigger pattern matching injects matched skill guidance into subagent prompts at runtime
- session branching isolates each task execution in its own Pi session
- `/omni-commit` creates branches, stages files, and commits with task-derived messages
- chain execution mode runs a scout agent before the worker for richer codebase context (configurable via `chainEnabled`)
- starter agent, skill, and prompt definitions
- automated tests covering initialization, repo signals, planning, status, escalation, skills, git, metrics, widgets, triggers, and launcher

## Development

- `npm test` - run the automated test suite
- `npm run check` - type-check the TypeScript code
- `node ./bin/omni.js --help` - launch the bundled Pi runtime through Omni-Pi

## Next steps

- parallel task execution for independent tasks with bounded concurrency
- full end-to-end demo with real subagent execution against a live codebase
- PR creation and review support with follow-up task capture

## Backlog

- PR review support, review summaries, and follow-up task capture
- worktree-based branch isolation for safer concurrent work
- agent performance analytics dashboard
