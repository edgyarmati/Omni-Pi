# Omni-Pi Backlog

## Phase 1: Fix the Foundation

Bugs and gaps that undermine trust. Do these first.

### 1.1 Fix config parsing double-escape

`parseModelTable()` in `src/config.ts` double-escapes `\|` so model overrides from `CONFIG.md` silently fail. Every user runs on `DEFAULT_CONFIG` without knowing it.

### 1.2 Fix skill trigger parsing

`parseTriggers()` regex in `src/skills.ts` only captures up to 3 trigger keywords. Skills with more triggers silently drop the rest.

### 1.3 Wire planner and brain agents

Config slots and `.md` definitions exist but `createSubagentWorkEngine` only dispatches worker and expert. `applyModelOverrides` ignores planner and brain.

### 1.4 Load prompt templates

`prompts/brainstorm.md`, `spec-template.md`, `task-template.md` exist on disk but no code reads them.

### 1.5 Deduplicate DEFAULT_CONFIG

Appears identically in both `src/contracts.ts` and `src/config.ts`.

---

## Phase 2: Language-Agnostic Verification

### 2.1 Expand isRunnableCommand() allowlist

Add: `make`, `cargo`, `go`, `python`, `pytest`, `php`, `composer`, `bundle`, `rake`, `dotnet`, `swift`, `mix`, `gradle`, `mvn`.

### 2.2 Language-aware test inference

Extend `inferTestCommandsFromContext()` to detect and produce commands for Python (pytest), Rust (cargo test), Go (go test ./...), Ruby (bundle exec rspec), PHP (composer test).

### 2.3 User-defined verification commands

Let users add custom commands in `TESTS.md` under `## Custom checks` that always run regardless of language detection.

---

## Phase 3: Workflow Templates

### 3.1 Define preset types

`bugfix`, `feature`, `refactor`, `spike`, `security-audit` — each configures task shape, verification depth, and agent behavior.

### 3.2 Add --preset flag to /omni-plan

Usage: `/omni-plan --preset bugfix "fix the login redirect loop"`. Bugfix skips interview, spike skips verification, etc.

### 3.3 Auto-detect preset from context

Infer from branch name (`fix/` -> bugfix, `feat/` -> feature) and brief content. Suggest, don't force.

---

## Phase 4: Self-Healing Doctor System

### 4.1 /omni-doctor command

Diagnostic command checking: environment (required tools), config (parseable CONFIG.md, valid model IDs), state (valid phase, orphaned tasks, stuck tasks), dependencies (package install succeeds).

### 4.2 Stuck detection

Sliding-window analysis: same error repeated, same task dispatched 3+ times, oscillation pattern. Surface actionable recovery suggestions.

### 4.3 Health indicator in dashboard widget

Extend `omni-memory` dashboard with traffic-light health: green (nominal), yellow (retrying), red (stuck or doctor failing).

### 4.4 Run doctor on init

Run basic health checks automatically during `omni-init`.

---

## Phase 5: Plan & Progress Memory (Markdown-based)

Instead of a complex ranked store, use the filesystem as the memory layer.

### 5.1 Plan files

Each `/omni-plan` invocation writes a dated plan file to `.omni/plans/YYYY-MM-DD-<slug>.md` containing the spec summary, task list, and acceptance criteria.

### 5.2 Plan index

`.omni/plans/INDEX.md` tracks all plans with their status:

```
| Plan | Date | Status | Tasks |
|------|------|--------|-------|
| 2026-03-26-auth-flow | 2026-03-26 | done | T01-T04 |
| 2026-03-27-dashboard | 2026-03-27 | active | T05-T08 |
```

Status values: `active`, `done`, `abandoned`.

### 5.3 Cleanup setting

A config setting in `CONFIG.md`: `Auto-cleanup completed plans: yes | no` (default: no).

When enabled, completing all tasks in a plan moves its file to `.omni/plans/archive/` or deletes it (configurable). The INDEX.md entry stays for history.

### 5.4 Progress journal

Each `/omni-work` completion appends a short entry to `.omni/PROGRESS.md`:

```
## 2026-03-26

- [T01] Completed: Confirm the initial project direction (worker, 1 attempt)
- [T02] Completed: Implement auth flow (expert, 3 attempts — root cause: missing DB seed)
```

This gives the developer a readable changelog of what the agent did and why.

---

## Phase 6: Context Engineering

### 6.1 Token budget system for subagent prompts

Character-based estimates (4 chars ~ 1 token). Budget allocation:
- System prompt + role: ~15%
- Memory/progress summary: ~10%
- Task spec + brief: ~20%
- Context files: ~40%
- Verification plan: ~10%
- Reserve: ~5%

Truncate least-relevant context files when over budget.

### 6.2 Pre-read context files into worker prompts

Instead of telling the worker "read these files", inject the content directly into the assembled prompt within the token budget.

### 6.3 Phase-aware context composition

Different phases get different context mixes:
- Planning: broad project context, decisions, repo signals
- Building: narrow task context, specific files, skills
- Checking: verification plan, test output, done criteria
- Escalating: full failure history, prior attempts, broader context

---

## Future / Parking Lot

- Better token estimation (model-aware tokenizer instead of char-based)
- Quick-start wizard that asks about plan cleanup preference
- Background memory extraction with cheap model (if markdown-based memory proves insufficient)
- `/omni-auto` single-command autonomous loop (deferred — needs stuck detection first)
- Parallel task execution in separate worktrees
- Web dashboard for progress visualization
