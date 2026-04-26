# Outstanding review findings

Captured from the thorough review on branch `claude/thorough-code-review-0ft6H`. Items already addressed in that branch's cleanup pass (CLAUDE/AGENTS doc drift, tsconfig tests inclusion, .gitignore, `updater.ts` HOME + `isNewer`, `repo-map-index.ts` dead ternary, `repo-map-store.ts` atomic write, `header.ts` version cache) are **not** repeated here.

Severity tags: `[CRIT] [HIGH] [MED] [LOW] [NIT]`. Every claim below was spot-checked against the source — claims the exploration agents got wrong have been excluded.

---

## High-impact items deferred for design discussion

### 1. [HIGH] Concurrent writers to `.omni/` state files

`src/workflow.ts`, `src/work.ts`, `src/skills.ts`, and `src/sync.ts` all read-modify-write `.omni/STATE.md`, `.omni/TASKS.md`, `.omni/SKILLS.md`, and per-task history JSON without locking, fsync, or atomic rename. If two Omni-Pi sessions run on the same `rootDir` (the launcher does not prevent it), the last writer silently wins.

Specific hot spots:
- `src/work.ts:284-289` — task history append (read → push → write).
- `src/skills.ts:587-670` — `ensureTaskSkillDependencies` reads `state`, mutates `state.managed`, writes back.
- `src/workflow.ts:196-210` and `:570-579` — `writeState` calls.
- `src/sync.ts:27-44` and `:62-69` — `appendBullets` / DECISIONS append.

Fix shape: cooperative locking via a `.omni/.lock` file with PID + heartbeat, or `proper-lockfile`. Atomic write-to-`.tmp`-then-`rename` for each terminal write (the same pattern just shipped for `repo-map-store.ts`).

Why deferred: this touches the workflow hot path; needs a single, deliberate locking story rather than scattered ad-hoc fixes.

---

### 2. [HIGH] `src/skills.ts:510-534` — generated skill content not escaped for YAML/markdown

`buildGeneratedSkill` interpolates `task.title`, `task.objective`, `task.doneCriteria`, and `task.contextFiles` straight into a markdown file with YAML frontmatter:

```ts
return `---
name: ${name}
description: Project-specific skill for ${task.title}. Triggers include ${triggerText}
---
# ${name}
Use this skill for the task "${task.title}".
...
```

A title containing `\n`, `"`, `---`, or backticks corrupts the frontmatter or breaks code-fence rendering. `name` is normalized via `normalizeSkillName` (`:489-494`), but the body fields are not.

Fix shape: collapse each interpolated field to a single line, strip control chars, and escape `"` for the YAML description. Reject (or replace) bodies containing `---` lines.

Why deferred: small change but the right escape strategy (truncate, quote, reject) is a product call.

---

### 3. [HIGH] `src/workflow.ts:323-343` — README/package.json content reaches the brain prompt unsanitized

`buildOnboardingInterviewKickoff` interpolates `init.onboardingContextHints` (assembled from `README.md` and `package.json#description` at `:244-303`) into the kickoff message handed to the brain. Trust model is normally "the user owns those files", but a fresh clone of an untrusted repo brings third-party text into a system-level prompt before the user has reviewed anything.

Fix shape: cap each hint to a single line and ~200 chars; strip `\n`, control chars, and backticks; never copy a hint that itself contains `## ` or `---` (which would shift markdown structure of the prompt).

---

### 4. [HIGH] `src/standards.ts:299-306` — `readOmniVersion` is too permissive

```ts
const parsed = Number.parseInt(content.trim(), 10);
return Number.isFinite(parsed) ? parsed : null;
```

`Number.parseInt` accepts trailing garbage (`"1\n# comment"` → `1`) but returns `NaN` for files that lead with a comment line. The function silently treats a comment-prefixed VERSION file as "version unknown" and triggers a re-import. Pick a strict parse (whole-string regex `^\d+\s*$`) or scan for the first integer line.

---

### 5. [HIGH] `src/repo-map-index.ts:399-408` — sequential `await stat()` per file

```ts
for (const filePath of discovered) {
  ...
  const stats = await stat(absolutePath);
  ...
}
```

For thousands of files, that's one round-trip per file before the cache hit/miss decision. Batch with `Promise.all` (or a small concurrency pool) the way the directory walk already does at `:144-147`.

---

## Medium

### 6. [MED] `bin/omni.js:24-28` — `buildOmniEnvironment` is a no-op pass-through

Spreads its input and returns it. Either delete it (and have `buildPiProcessSpec` return `env: baseEnv` directly) or use it for the actual job (e.g., setting `PI_SKIP_VERSION_CHECK` here instead of from the module-level mutation in `src/updater.ts:183`). Deferred because deleting it changes the launcher API surface and `tests/launcher.test.ts:26-30` covers it.

### 7. [MED] `src/updater.ts:183` — module-level mutation of `process.env`

```ts
process.env.PI_SKIP_VERSION_CHECK = "1";
```

Runs as a side effect on `registerUpdater(api)`. Move into `runOmni` / the launcher boundary, or thread it through `buildOmniEnvironment` (see #6).

### 8. [MED] `src/repo-map-index.ts:267-268` — import regex uses unbounded `[\s\S]*?`

```ts
/^(?:import\s+[\s\S]*?\s+from\s+|export\s+[\s\S]*?\s+from\s+)["']([^"']+)["'];?/gmu
```

`^` is multi-line anchored and `from` is required, so worst-case backtracking is bounded — but a long single-line minified file with many `import` keywords and no `from` will burn CPU. Tighten to `[^;\n]*?` or use a real tokenizer.

### 9. [MED] `src/repo-map-index.ts` — fingerprint type is implicitly a discriminated union

The success path (`:355-357`) stores `hashContent(content)`; the read/parse-error fallback (`:429-446`) stores `${size}:${mtimeMs}`. Both live in the same `fingerprint: string` field. Tag the discriminant — `{ kind: "hash" | "stat", value }` — or persist them in different fields. Today, fallback entries can be treated as "unchanged" forever because the cache lookup at `:403-408` only compares `mtimeMs` + `size`.

### 10. [MED] `src/repo-map-runtime.ts:14-58` — no synchronization on `warmRepoMap`

`dirtyPaths` is captured at `:54` and cleared at `:56`. Two concurrent calls observe the same set, then the first clears it — second caller's edits are lost. Memoize the in-flight promise, or atomically `splice` the set instead of read-then-clear.

### 11. [MED] `src/skills.ts:613-670` — `state.managed` grows without pruning

Each task run appends a record; same-name records are filtered out, but the array still grows monotonically because each task gets its own appended entry across rerun cycles, and `taskRefs` has no upper bound. Cap or de-duplicate.

### 12. [MED] `src/tasks.ts:13-45` — markdown table parser doesn't escape pipes inside code spans

`splitMarkdownTableRow` handles `\\` and `\|` but not, e.g., backticked code containing a raw `|`. A title like `` `a|b` `` becomes two cells. Normalize titles on write (forbid raw `|`), or use a stricter parser.

### 13. [MED] `src/sync.ts:62-65` — DECISIONS.md entries don't escape YAML special characters

A decision string with a leading `-`, an embedded `:`, or a newline corrupts the YAML-ish format consumed downstream. Single-line / fence the content.

### 14. [MED] `src/theme.ts` — module-level mutable state

`activeBrand`, `activeWelcome`, `activePresetName` are top-level bindings mutated by exported setters. Fine for a single-process CLI, but makes the module non-reentrant for tests / future embedding. Wrap in a small object/factory.

### 15. [MED] `src/todo-shortcut.ts:204` — `widgetVisible` is a module-level boolean

Same shape as #14. Fine today; will desync if the widget is ever re-instantiated within one session.

---

## Low / nits

### 16. [LOW] `src/repo-map-index.ts:240-250` — `uniqueSymbols` keys on `kind:name:exported`

Function overloads collapse into one entry. Acceptable for a "lite" map; worth a code comment so readers don't expect a full symbol table.

### 17. [LOW] `src/repo-map-rank.ts:32-59` — PageRank fixed at 12 iterations

Magic number, no convergence check. Document the choice or make it tunable.

### 18. [LOW] `src/planning.ts:248-254` — relation overlap threshold hard-coded to `0.34`

Magic number. Document or surface as config.

### 19. [LOW] `templates/omni/...` — hard-coded model name `anthropic/claude-opus-4-6`

Will go stale. Either pull from config or document a version-bump checklist.

### 20. [LOW] `tests/repo-map.test.ts:77` — real-clock dependency

`await new Promise((resolve) => setTimeout(resolve, 20))` for an mtime rollover. Use `vi.setSystemTime` or stub the relevant `Date.now`.

### 21. [LOW] `tests/rtk.test.ts:78-129` — `bashEvent.input.command` is mutated across handler invocations

Order-dependent. Clone with `structuredClone` between calls.

### 22. [NIT] Inconsistent style — `filter(Boolean)` vs explicit `line.length > 0`

Mixed throughout `src/skills.ts`, `src/tasks.ts`, `src/planning.ts`. Pure aesthetics.

### 23. [NIT] `agents/brain.md` doesn't say it's the active agent

`agents/expert.md`, `agents/planner.md`, `agents/worker.md` are explicitly archived; `brain.md` does not state it's the only active one. A one-line banner would prevent confusion.

### 24. [NIT] `PLAN.md` is five lines of "see README"

Consider deleting or linking from README under an Archive section.

### 25. [NIT] `skills/skill-creator/SKILL.md` is 485 lines — the skill itself recommends ≤500

Approaching its own ceiling; could be broken out into linked references for setup / testing / improving.

---

## Test coverage gaps

| Module | Direct tests | Gaps |
|---|---|---|
| `src/work.ts` | none direct (only via `runtime.test.ts`, 1 test) | retry limits, history append, error branches |
| `src/skills.ts` (721 LOC) | only via `workflow.test.ts` integration | unit tests for `normalizeSkillName`, `buildGeneratedSkill` (#2), `ensureTaskSkillDependencies` race / dedup |
| `src/repo-map-index.ts` | `tests/repo-map.test.ts` | mtime+size collision, very large files, symlink loops, anchored gitignore (#9), pathological regex input |
| `src/repo-map-runtime.ts` | indirect | concurrent `warmRepoMap` (#10), `dirtyPaths` overflow |
| `src/standards.ts` | partial | `readOmniVersion` malformed input (#4) |
| `src/theme.ts` / `theme-command.ts` | none | preset round-trip, hex parsing |
| `bin/omni.js` | `tests/launcher.test.ts` covers spawn args | no test for SIGINT/SIGTERM forwarding |

---

## Claims rejected during review

These were flagged with high confidence by exploration agents but are **wrong** — recording them so they don't get re-raised:

- *"`bin/omni.js` promise resolves twice / `clearTimeout` is called on a missing timer."* The promise resolves on `exit`, rejects on `error`; both handlers detach the same listeners. There is no `clearTimeout` in `bin/omni.js`.
- *"`src/standards.ts:331-338` has inverted gitignore-write logic."* Reads correctly: returns `false` when `.pi/` is already present and writes + returns `true` when missing.
- *"Path traversal in `src/skills.ts` skill names."* `normalizeSkillName` (`:489-494`) strips everything outside `[a-z0-9]+` and clamps to 48 chars, so `../../foo` becomes `foo`. The real exposure is body-content escaping (#2), not the path.
- *"`runNpmInstall` promise never rejects (CRIT)."* By design; the resolved object carries the exit code.
