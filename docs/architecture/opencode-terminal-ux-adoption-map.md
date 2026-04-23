# OpenCode Terminal UX Adoption: Source Audit + Compatibility Map

Date: 2026-04-23  
Track: O1 (OpenCode source audit and compatibility mapping)

## Scope

This mapping identifies the primary OpenCode terminal UI surfaces to vendor/adapt for Omni standalone, and how they map onto Omni's existing Pi-RPC architecture.

OpenCode source audited under:
- `/tmp/pi-github-repos/anomalyco/opencode/packages/opencode/src/cli/cmd/tui/`

Omni target source:
- `src/standalone/`

## Architectural fit summary

- **Good fit:** OpenCode TUI is OpenTUI/Solid and already split into app/context/route/component layers.
- **Hard seam:** OpenCode UI binds to `@opencode-ai/sdk` session/provider/event contracts.
- **Adoption strategy:** Vendor/adapt UX components while routing behavior through an Omni adapter over Pi RPC.

## Mapping table (phase-oriented)

| Priority | OpenCode source | Responsibility | Omni target | Decision |
| --- | --- | --- | --- | --- |
| P0 | `app.tsx` | root providers, routing, dialog stack, keyboard hooks | `src/standalone/opentui-shell.ts` + new adapter bootstrapping | **Adapt** |
| P0 | `routes/session/index.tsx` | primary session transcript/shell behavior | `src/standalone/opentui-shell.ts` + `presenter.ts` | **Adapt heavily** |
| P0 | `component/prompt/index.tsx` | composer behavior, history, autocomplete, submission orchestration | `src/standalone/opentui-shell.ts` + `composer.ts` + controller submit flow | **Adapt heavily** |
| P0 | `component/dialog-command.tsx` | command palette + slash registry behavior | `src/standalone/commands.ts` + dialog state in controller/shell | **Adapt** |
| P1 | `routes/session/sidebar.tsx` | session side rail and status/context affordances | `src/standalone/opentui-shell.ts` + workflow/todo renderers | **Adapt** |
| P1 | `component/dialog-model.tsx`, `component/dialog-provider.tsx`, `component/dialog-session-list.tsx` | model/provider/session selectors and flows | `src/standalone/controller.ts` dialog bridge + `opentui-shell.ts` dialog UI | **Adapt** |
| P1 | `ui/dialog-select.tsx`, `ui/dialog-prompt.tsx`, `ui/dialog-confirm.tsx` | reusable dialog primitives | `src/standalone/opentui-shell.ts` dialog overlay components | **Vendor/Adapt** |
| P2 | `feature-plugins/sidebar/*.tsx`, `feature-plugins/home/*.tsx` | plugin-driven side sections and home helpers | Omni workflow/repo-map panels and future plugin hooks | **Selective adapt** |
| P2 | `context/theme.tsx` + bundled themes | theme state and tokens | `src/theme.ts` + shell palette | **Selective adapt** |

## Contracts that must be replaced (not vendored directly)

| OpenCode dependency seam | Why replacement is required | Omni replacement path |
| --- | --- | --- |
| `@opencode-ai/sdk/v2` session/provider APIs | Bound to OpenCode server/API semantics | `src/standalone/rpc/client.ts` + adapter mapper |
| OpenCode sync/event stores (`useSync`, `useEvent`) | Event and entity schemas differ | `createStandaloneController` state + adapter contracts |
| OpenCode provider/auth workflows | Coupled to OpenCode provider runtime | Omni provider hub/bridges over Pi extension UI and local config |

## Omni seams that remain mandatory

1. `.omni/` workflow state visibility (`STATE`, `TASKS`, `SESSION-SUMMARY`, etc.).
2. Omni command/bridge flows (`/providers`, repo-native helpers, recovery affordances).
3. Pi RPC as backend boundary (no direct adoption of OpenCode server runtime).
4. Omni-specific chat/tool exposure rules.

## Immediate implementation handoff

- O2 introduces stable adapter contracts in `src/standalone/opencode-adapter/`.
- O3 starts transcript/composer/command behavior adoption using these contracts.
- Every vendored/adapted file must carry provenance notes and be recorded in `CREDITS.md` when substantial copying occurs.
