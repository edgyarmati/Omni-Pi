# Omni-Pi v1 Implementation Spec

## Goal

Deliver a usable Pi package scaffold for guided, disk-first project planning and implementation.

## Primary outcomes

- a recognizable package structure that can evolve into a working Pi package
- a stable `.omni/` memory model
- clear role boundaries for brain, planner, worker, verifier, and expert behavior
- enough templates and contracts to start wiring real command handlers next

## Command behavior

### `/omni-init`

- create `.omni/` if it does not exist
- write starter memory files if missing
- inspect project signals like `package.json`, lockfiles, framework configs, and language markers
- propose initial skills
- auto-install only high-confidence, low-risk skills
- update `.omni/PROJECT.md`, `.omni/STATE.md`, `.omni/SKILLS.md`

### `/omni-plan`

- read the minimum relevant `.omni/` files
- produce or refresh `.omni/SPEC.md`
- decompose work into bounded slices in `.omni/TASKS.md`
- define checks and escalation criteria in `.omni/TESTS.md`
- recommend any missing skills

### `/omni-work`

- select the next incomplete task slice
- build a minimal task brief for the worker
- route only the relevant skills into the worker context
- run verification after implementation
- retry up to the configured threshold
- escalate to expert when retries are exhausted
- write updated notes into `.omni/STATE.md` and `.omni/SESSION-SUMMARY.md`

### `/omni-status`

- read `.omni/STATE.md`
- render a plain-English explanation of phase, progress, blockers, and next step

### `/omni-sync`

- consolidate useful recent context into `.omni/SESSION-SUMMARY.md`
- move durable learnings into `.omni/DECISIONS.md`, `.omni/SPEC.md`, or `.omni/TASKS.md`

### `/omni-skills`

- show installed, recommended, deferred, and rejected skills
- explain why each skill is present or absent

### `/omni-explain`

- translate the current Omni-Pi workflow into plain language for beginners

## Runtime rules

- launch through a branded `omni` command
- boot Pi with `PI_PACKAGE_DIR` pointed at the Omni-Pi package root
- guided step mode only
- no autonomous looping
- no hidden destructive operations
- no broad skill installation without clear justification
- no task slice without explicit done criteria

## Next implementation pass

1. add real command handlers for `/omni-init`, `/omni-plan`, and `/omni-status`
2. wire starter templates into filesystem creation logic
3. add repo signal detection for skill recommendations
4. define the worker retry and expert escalation state machine
5. connect the agent markdown files to real subagent dispatch

## Implemented now

- `.omni/` starter files can be created through the filesystem-backed initialization workflow
- repo signals are detected from common project files and `package.json`
- skill candidates are inferred and written into `.omni/SKILLS.md`
- initial planning artifacts can be generated deterministically into `.omni/SPEC.md`, `.omni/TASKS.md`, and `.omni/TESTS.md`
- status can be parsed from `.omni/STATE.md` and rendered in plain English
- command registration scaffolding exists for core Omni-Pi commands
- `/omni-work` now has a tested execution state machine with retry history and expert escalation scaffolding
- skill registry data can be parsed, rendered, and turned into install plans
- `/omni-sync` now writes recent progress back into `.omni/SESSION-SUMMARY.md` and `.omni/DECISIONS.md`
- `bin/omni.js` launches the bundled Pi runtime with Omni-Pi resources preloaded
- automated tests cover the current implementation surface

## Remaining gaps

- tighter integration with Pi's concrete extension APIs
- real skill installation execution
- direct worker and expert execution through Pi runtime
- expert escalation runtime integration
- richer planning inputs from live user conversations
- real skill command execution and skill auto-install policy enforcement
