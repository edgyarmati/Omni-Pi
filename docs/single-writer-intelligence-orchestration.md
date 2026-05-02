# Single-Writer Intelligence Orchestration

## Purpose

This is the implementation handoff for bringing the current OmniCode orchestration model back into Omni-Pi.

The rule to preserve is:

> Context can be parallelized. Intelligence can be parallelized. Writes, scope decisions, verification judgment, commits, and PR decisions stay with the primary Omni brain.

This replaces any older worker-subagent direction. Omni-Pi should not reintroduce a writer worker, planner owner, expert writer, or shared-worktree multi-agent swarm.

## Final decisions from OmniCode

- The primary `omni` / Omni-Pi brain is the only active-worktree writer and decision owner.
- Optional subagents are read-only intelligence contributors only.
- Supported roles are exactly:
  - `omni-explorer` — evidence-backed discovery packets.
  - `omni-planner` — smart-friend planning critique and risk review.
  - `omni-verifier` — verification support and clean-context review.
- There is no `omni-worker` or writer subagent role.
- Do not implement branch/worktree-backed writer workers for this pass. If that idea returns later, it needs a separate explicit design and user-facing mode.
- The planner may recommend a plan, but the primary brain writes the actual `.omni/` plan and owns what is accepted.
- The verifier may report findings, but the primary brain adjudicates accepted vs rejected findings and performs fixes.
- Subagents must not edit source, write `.omni/` planning files, run mutating shell commands, commit, push, or open PRs.

## Settings model

Agent settings should live outside `.omni/`, because `.omni/` is durable workflow memory, not runtime/model configuration.

Use:

- global settings: `~/.omnicode/settings.json` or Omni-Pi's equivalent global config path;
- project override: `.omnicode/settings.json`, gitignored;
- never `.omni/` for model settings.

The current settings shape supports string models and richer model objects:

```json
{
  "agents": {
    "enabled": true,
    "defaultModel": "provider/model",
    "models": {
      "omni-explorer": "opencode/nemotron-3-super-free",
      "omni-planner": {
        "model": "openai/gpt-5.5",
        "reasoningEffort": "high"
      },
      "omni-verifier": {
        "model": "openai/gpt-5.5",
        "reasoningEffort": "low"
      }
    }
  }
}
```

Implementation requirements:

- `agents.enabled` defaults to `false`.
- Missing `defaultModel` means subagents inherit the invoking/orchestrator model unless a per-agent model is set.
- `agents.models` may contain either:
  - a model string, e.g. `"provider/model"`; or
  - an object with at least `model`, plus provider-supported options such as `reasoningEffort`.
- Project settings override global settings.
- Unknown/unsupported role keys must be ignored or cleaned during settings writes.
- In particular, stale `omni-worker` entries must not register a subagent or appear in permissions.
- Settings writes should persist only selected user values, not bundled prompt text or default agent definitions.

## Runtime registration

When `agents.enabled` is false, register only the primary Omni agent.

When true, register the three optional intelligence roles:

- `omni-explorer`
- `omni-planner`
- `omni-verifier`

The primary brain may delegate tasks only to these roles. A safe permission shape is:

```json
{
  "task": {
    "*": "deny",
    "omni-explorer": "allow",
    "omni-planner": "allow",
    "omni-verifier": "allow"
  }
}
```

Do not include `omni-worker`.

## Role contracts

### `omni-explorer`

Purpose: read-only repo discovery.

Allowed:

- search files;
- read files;
- inspect docs, tests, standards, and prior plans;
- return concise evidence-backed discovery packets.

Required output:

```md
## Findings
- ...

## Evidence
- `path/to/file.ts:42` — relevant fact

## Risks / edge cases
- ...

## Uncertainty
- ...

## Recommended next inspection
- ...
```

Forbidden: edits, mutating shell commands, planning-file writes, commits, pushes, PRs.

### `omni-planner`

Purpose: smart-friend planning critique.

It helps the primary brain identify missing context, edge cases, test seams, non-goals, and safer slice boundaries.

It should answer broadly enough to catch flaws, but must say what to inspect next rather than inventing facts.

Required output:

```md
## Plan critique
- ...

## Missing questions or constraints
- ...

## Suggested slices
- ...

## Test strategy
- ...

## Risks / non-goals
- ...

## Recommended next inspection
- ...
```

The primary brain decides what to accept and writes `SPEC.md`, `TASKS.md`, and `TESTS.md`.

### `omni-verifier`

Purpose: clean-context review and verification support.

Use after the primary brain implements a slice and runs planned checks.

Required output:

```md
## Verification review

### Findings
- Severity:
- Evidence:
- Suggested fix:
- Confidence:
- Blocks commit: yes/no

## Test/coverage gaps
- ...

## Scope or contract mismatches
- ...
```

The primary brain adjudicates each finding, fixes accepted issues, reruns verification, updates session notes, and commits.

## Workflow integration

Omni-Pi should follow this sequence for change requests when Omni mode is active:

1. Run a collaboration/status checkpoint if branch/work memory exists.
2. Clarify with the user before planning unless the request is already concrete.
3. Run a skill-fit checkpoint.
4. Use `omni-explorer` for codebase discovery when context is needed.
5. Use `omni-planner` for risky or non-trivial planning critique.
6. Primary brain writes/refines `.omni/` planning artifacts.
7. Implement one bounded slice at a time.
8. Run planned checks.
9. Use `omni-verifier` or equivalent clean-context review before meaningful commits.
10. Primary brain adjudicates findings, fixes accepted issues, reruns checks, records progress, and commits.

## `/omni-agents` setup command

Add or update a setup command with these actions:

- `status` — show global, project, and effective settings.
- `on` / `off` — enable or disable globally.
- `on --project` / `off --project` — enable or disable the project override.
- `setup` — guided setup.

Guided setup should:

1. Explain the single-writer invariant before recommending models.
2. Show current settings and any model recommendations file.
3. Try to list available runtime models; if not possible, accept manual `<provider>/<model>` strings.
4. Ask one question at a time:
   - enable subagents?
   - global or project settings?
   - inherit orchestrator model or choose a shared default?
   - choose optional per-agent models/options?
5. Recommend:
   - cheaper/faster model for `omni-explorer`;
   - strongest reasoning model for `omni-planner`;
   - reliable/tool-capable model for `omni-verifier`.
6. Write only the selected settings values.
7. Explain that changes take effect after the runtime reloads configuration.

## Environment isolation warning from OmniCode

OmniCode currently isolates OpenCode by launching it with `XDG_CONFIG_HOME=~/.config/omnicode`. That successfully protects the user's normal OpenCode config, but it leaked into child shell tools and made unrelated CLIs such as `gh` miss their normal auth config.

If Omni-Pi adds similar isolation, do not globally leak an overridden `XDG_CONFIG_HOME` into generic tool shells. Prefer one of:

- runtime-specific config env vars only;
- sanitize tool subprocess env;
- unset isolation env for external CLIs that should use the user's normal config.

Acceptance criterion: `gh auth status` and similar user CLIs should see the user's normal auth/config unless a command intentionally opts into the isolated runtime config.

## Tests to add

- Settings merge: defaults, global, project override.
- Settings parser accepts string models and object model configs.
- Unknown roles and stale `omni-worker` are ignored/cleaned.
- Disabled agents register no optional subagents.
- Enabled agents register only explorer/planner/verifier.
- Primary brain task permissions deny `*` and allow only the three intelligence roles.
- Prompts for all roles forbid edits and mutating commands.
- `/omni-agents status/on/off/setup` writes only user settings.
- Clean-context review output requires evidence, confidence, suggested fix, and block/non-block status.
- Tool subprocesses do not inherit runtime config isolation in a way that breaks user CLI auth.

## Success criteria

- Omni-Pi preserves one active-worktree writer: the primary Omni brain.
- Subagents improve discovery, planning, and verification without owning decisions.
- Model settings support per-agent model strings and richer option objects.
- No writer role is registered, documented, recommended, or permissioned.
- The setup flow makes the no-writer model clear to users.
- User CLI config/auth is not broken by runtime config isolation.
