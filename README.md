# Omni-Pi

Omni-Pi is an opinionated Pi package and branded launcher for guided software delivery.

It is designed to feel simple for beginners while still using a stronger planning model, focused worker subagents, explicit verification, and expert fallback behind the scenes.

## Attribution

Omni-Pi builds on top of the Pi ecosystem and intentionally borrows ideas from earlier community work.

- Pi runtime and package model: [badlogic/pi-mono](https://github.com/badlogic/pi-mono) by Mario Zechner and contributors
- orchestration and workflow inspiration: [can1357/oh-my-pi](https://github.com/can1357/oh-my-pi)
- disk-first guided workflow inspiration: [gsd-build/gsd-2](https://github.com/gsd-build/gsd-2)
- subagent and Pi ecosystem inspiration: nicopreme/nicobailon packages and related Pi community extensions

The goal of Omni-Pi is to contribute a distinct, beginner-friendly, opinionated package back into that ecosystem while giving clear credit to the original authors and projects that made it possible.

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
- Omni-Pi boots the Pi runtime with `PI_PACKAGE_DIR` pointed at this package so the bundled Omni extensions, skills, and prompts are available immediately

## Planned commands

- `/omni-init` - initialize `.omni/` and analyze the project
- `/omni-status` - explain current state and next step
- `/omni-plan` - create or refresh spec, tasks, and tests
- `/omni-work` - run the next task through worker, verifier, and expert fallback
- `/omni-sync` - update durable memory files from recent progress
- `/omni-skills` - inspect installed and recommended skills
- `/omni-explain` - explain what Omni-Pi is doing in simple language

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
- starter agent, skill, and prompt definitions
- automated tests covering initialization, repo signal detection, planning, status rendering, command registration, and launcher setup

## Development

- `npm test` - run the automated test suite
- `npm run check` - type-check the TypeScript code
- `node ./bin/omni.js --help` - launch the bundled Pi runtime through Omni-Pi

## Next steps

- tighten the launcher/runtime integration against Pi's concrete extension APIs
- replace the placeholder `/omni-work` execution engine with real Pi subagent dispatch
- execute real skill installation commands from the planned install flow
