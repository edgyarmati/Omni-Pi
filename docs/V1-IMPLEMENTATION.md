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
- Omni extensions now register commands through Pi's real `ExtensionAPI`
- `/omni-init` can execute skill-install commands through Pi's runtime `exec()` API
- `/omni-work` can delegate worker/expert execution to `pi-subagents` while preserving Omni-Pi's retry and state machine
- subagent raw outputs and per-attempt metadata are persisted into `.omni/tasks/` for later review
- runtime verification now executes runnable commands from `.omni/TESTS.md` and uses those outcomes as the authoritative pass/fail signal
- task-specific verification can now filter `.omni/TESTS.md` down to relevant checks for the current task
- automated tests cover the current implementation surface
- expert escalation now tracks modified files from worker attempts and surfaces recovery options when both worker and expert fail
- escalation briefs include verification results and modified files from all prior attempts
- recovery options are persisted into `.omni/STATE.md` and rendered in plain-English status output
- Pi-native message renderers for verification results, status summaries, and escalation notices with structured details
- commands return structured results with dedicated message types when running inside the Pi runtime
- planning now reads existing `.omni/DECISIONS.md`, `.omni/SESSION-SUMMARY.md`, and prior `.omni/SPEC.md` to incorporate decisions, session notes, and completed tasks
- skill install failures are tracked and failed skills are moved to the deferred section with error details
- `applyInstallResults` provides a recovery path that updates the SKILLS.md registry on install failure
- task-level verification now infers test commands from context files and includes done criteria as expectations
- verification plans combine project-wide checks, task-specific checks, context-inferred test commands, and done criteria
- persistent dashboard widget via `ctx.ui.setWidget()` in the `omni-memory` extension, auto-updates on session start, switch, and turn end
- run history integration via pi-subagents' `recordRun()` and `loadRunsForAgent()`, with `/omni-status metrics` rendering
- interactive planning refinement via `ctx.ui.input()` and `ctx.ui.confirm()` for constraints, user context, and plan approval
- skill trigger pattern matching parses SKILL.md descriptions at runtime and injects matched skill content into subagent prompts
- session branching via `ctx.newSession()` wraps each subagent task execution in an isolated session
- `/omni-commit` command creates branches, stages modified files, and commits with task-derived messages using `runtime.pi.exec()`
- chain execution via `createChainWorkEngine` runs a scout agent before the worker, enriching task context with codebase analysis
- `chainEnabled` config flag controls whether scout-then-worker or single-shot execution is used

## Remaining gaps

- parallel task execution for independent tasks with no dependency relationship
- full end-to-end demo with real subagent execution against a live codebase
- PR creation and review support
