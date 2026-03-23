# Omni-Pi v1 Plan

## Product Shape

- Omni-Pi is a Pi package with opinionated extensions, skills, prompts, and agent definitions.
- It runs in guided step mode only for v1.
- It stores durable project context in `.omni/` so agents can rehydrate focused context cheaply.
- It prioritizes beginner clarity while preserving expert routing under the hood.

## Working Defaults

- Product/package name: `Omni-Pi`
- Project state folder: `.omni/`
- Command prefix: `/omni-*`
- v1 flow: `Understand -> Plan -> Build -> Check -> Escalate`
- Retry policy: 2 worker attempts, then expert takeover

## v1 Milestones

1. Package skeleton and command surface
2. `.omni/` initialization and memory model
3. Brain/planner/worker/expert role contracts
4. Verification and escalation loop
5. Skill discovery, installation, and routing
6. Beginner-facing status and explanation UX

## Repo / Package Layout

- `package.json` - Pi package manifest and install metadata
- `extensions/`
- `extensions/omni-core/` - command registration and top-level orchestration
- `extensions/omni-memory/` - `.omni/` read/write/update helpers
- `extensions/omni-skills/` - skill discovery, registry, install policy
- `extensions/omni-status/` - plain-English progress and state summaries
- `skills/`
- `skills/omni-init/` - initialization workflow guidance
- `skills/omni-planning/` - planner workflow guidance
- `skills/omni-execution/` - worker workflow guidance
- `skills/omni-verification/` - verifier workflow guidance
- `skills/omni-escalation/` - expert fallback workflow guidance
- `agents/`
- `agents/brain.md`
- `agents/planner.md`
- `agents/worker.md`
- `agents/expert.md`
- `prompts/`
- `prompts/brainstorm.md`
- `prompts/spec-template.md`
- `prompts/task-template.md`
- `README.md`

## Pi Package Manifest

- `keywords`: include `pi-package`
- `pi.extensions`: `./extensions`
- `pi.skills`: `./skills`
- optionally `pi.prompts`: `./prompts`

## Commands

- `/omni-init`
  - creates `.omni/`
  - interviews the user
  - scans repo/project type
  - writes starter files
  - proposes and installs initial skills
- `/omni-status`
  - reads `.omni/STATE.md`
  - explains current phase, active task, blockers, next best step
- `/omni-plan`
  - asks planner to produce/update `SPEC.md`, `TASKS.md`, `TESTS.md`
- `/omni-work`
  - selects next task
  - routes to worker
  - runs verification
  - retries or escalates if needed
- `/omni-sync`
  - updates memory files from recent work/conversation
- `/omni-skills`
  - shows installed, recommended, deferred skills and reasons
- `/omni-explain`
  - explains what Omni-Pi is doing in beginner-friendly language

## `.omni/` File Model

- `.omni/PROJECT.md`
  - project summary
  - primary users
  - success criteria
  - constraints
- `.omni/IDEAS.md`
  - brainstorm backlog
  - future ideas
  - rough experiments
- `.omni/DECISIONS.md`
  - append-only dated decisions
  - rationale
  - impact
- `.omni/STATE.md`
  - current phase
  - active task
  - last result
  - blocker
  - next action
- `.omni/SKILLS.md`
  - installed skills
  - recommended skills
  - deferred skills
  - rejected skills
  - last-used notes
- `.omni/SPEC.md`
  - current product/technical spec
- `.omni/TASKS.md`
  - planned slices
  - dependencies
  - owner role
  - status
- `.omni/TESTS.md`
  - verification commands
  - acceptance criteria
  - retry threshold
  - escalation conditions
- `.omni/SESSION-SUMMARY.md`
  - rolling handoff summary
  - important recent context
- `.omni/research/`
  - package research
  - ecosystem notes
  - fetched references
- `.omni/specs/`
  - versioned detailed specs
- `.omni/tasks/`
  - per-task briefs
  - per-task outputs
  - per-task failure history

## Recommended File Templates

- `PROJECT.md`
  - `# Project`
  - `## Goal`
  - `## Users`
  - `## Constraints`
  - `## Success Criteria`
- `STATE.md`
  - `Current Phase:`
  - `Active Task:`
  - `Status Summary:`
  - `Blockers:`
  - `Next Step:`
- `SKILLS.md`
  - `## Installed`
  - `## Recommended`
  - `## Deferred`
  - `## Rejected`
  - `## Usage Notes`
- `TASKS.md`
  - task ID
  - title
  - role
  - dependency
  - status
  - done criteria
- `TESTS.md`
  - project-wide checks
  - task-specific checks
  - retry policy
  - escalation threshold

## Agent Role Definitions

- `brain`
  - user-facing
  - friendly, simple, adaptive
  - updates memory files via extension helpers
  - decides when to invoke planner/worker/expert
  - hides internal complexity unless asked
- `planner`
  - strong model
  - reads targeted `.omni/` files
  - writes/refines detailed spec and slices
  - identifies needed skills and tests
- `worker`
  - cheaper model
  - gets one bounded task brief
  - uses relevant skills only
  - produces implementation + concise result notes
- `expert`
  - strong model
  - receives failure history, attempted fixes, and verifier output
  - handles difficult tasks or repeated failures

## Execution Contracts

- `ConversationBrief`
  - normalized user intent
  - desired outcome
  - constraints
- `ImplementationSpec`
  - scope
  - architecture
  - task slices
  - acceptance criteria
- `TaskBrief`
  - task ID
  - objective
  - files/context
  - skills to load
  - done criteria
- `VerificationResult`
  - checks run
  - pass/fail
  - failure summary
  - retry recommendation
- `EscalationBrief`
  - task ID
  - prior attempts
  - failure logs
  - expert objective

## Skill Lifecycle Spec

- On `/omni-init`
  - inspect repo signals: `package.json`, lockfiles, framework config, languages, tooling
  - infer needed capabilities: docs lookup, testing, frontend, backend, browser, API, deployment
  - use `find-skills` discovery flow
  - build candidate list
  - install high-confidence skills
  - record everything in `.omni/SKILLS.md`
- During `/omni-plan`
  - planner may recommend new skills based on scope
- During `/omni-work`
  - if task requires missing high-confidence skill, install and register it before dispatch
- Skill routing
  - brain selects relevant skills
  - only those skills are attached to the subagent/task context

## Skill Policy

- `auto-install`
  - only for high-confidence, low-risk skills
- `recommend-only`
  - for ambiguous or broad skills
- `never-auto-install`
  - for risky, highly privileged, or unclear packages

## Verification Loop

- Worker completes task
- Verifier runs task-specific and project-wide checks from `.omni/TESTS.md`
- If pass:
  - mark task done
  - update `STATE.md`, `TASKS.md`, `SESSION-SUMMARY.md`
- If fail first/second time:
  - generate compact failure brief
  - re-dispatch same task to worker
- If fail after threshold:
  - generate `EscalationBrief`
  - hand to expert
- After expert:
  - rerun verification
  - record outcome

## Beginner UX Rules

- Always translate internals into simple status language
- Use "checking your app" instead of "running verification pipeline"
- Use "bringing in a more advanced problem-solver" instead of "expert subagent escalation"
- Keep `/omni-status` readable in under 10 seconds
- Keep all `.omni/` files human-readable

## Model Routing

- `brain`: conversational, warm, mid/high quality
- `planner`: strongest reasoning model
- `worker`: cheap fast model
- `expert`: strongest implementation/debugging model

## v1 Non-Goals

- no autonomous looping
- no worktree orchestration
- no team/multi-terminal coordination
- no dashboards/reports
- no broad MCP dependency
- no advanced swarm DAGs

## Suggested Build Order

1. Package manifest and directory structure
2. `/omni-init` and `.omni/` templates
3. Memory helper layer
4. Brain/planner role integration
5. `/omni-plan`
6. `/omni-work` with worker/verifier
7. Expert escalation
8. Skill discovery/install flow
9. `/omni-status`, `/omni-explain`, `/omni-skills`

## Risks To Watch

- too much hidden automation too early
- skill auto-install becoming noisy or unpredictable
- memory files growing bloated without compaction rules
- planner producing slices too large for worker contexts

## Recommended v1 Guardrails

- planner must keep tasks small and concrete
- every task must have explicit done criteria
- only targeted `.omni/` files get loaded per step
- skill install decisions must be logged in `SKILLS.md`
- escalation history must be persisted per task
