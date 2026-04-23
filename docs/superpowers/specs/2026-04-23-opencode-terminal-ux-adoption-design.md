# OpenCode-Style Terminal UX Adoption Design (Omni-Pi)

Date: 2026-04-23  
Status: Approved

## Goal

Adopt a near-clone OpenCode terminal UX for Omni standalone while keeping Omni-Pi's backend on Pi RPC and preserving Omni-specific workflow/product behavior.

## User-approved constraints

- Target OpenCode terminal UX behavior and interaction model aggressively.
- Do not switch to desktop shell architecture for this phase.
- Preserve Omni-Pi core seams explicitly:
  - `.omni/` workflow visibility and lifecycle
  - Omni-specific commands/bridges/provider flows
  - Omni chat/tool exposure choices that reflect product behavior
- Keep legal attribution for adapted MIT code.

## Approaches considered

### A) Full UI vendoring + Omni adapter (recommended)

Vendor/adapt large OpenCode terminal UI surfaces and keep compatibility through an Omni adapter layer over Pi RPC.

**Pros**
- Fastest path to OpenCode-like UX fidelity.
- Maximizes reuse of already-polished behavior.
- Reduces local reimplementation drift.

**Cons**
- Requires a strong compatibility boundary.
- Inherits upstream structural assumptions.

### B) Hybrid subsystem transplant

Port transcript/composer/commands first and keep the rest of current shell.

**Pros**: lower initial risk.  
**Cons**: slower to reach full UX parity and likely inconsistent feel.

### C) Reimplementation from reference

Use OpenCode as design reference only.

**Pros**: cleanest local architecture.  
**Cons**: slowest and highest risk of never reaching desired polish.

## Architecture decision

Choose **Approach A** with two hard boundaries:

1. **OpenCode-shaped UI layer**
   - Owns terminal UX surfaces: transcript rendering, composer, commands/dialogs, sidebar/session shell.
2. **Omni engine adapter layer**
   - Translates Pi RPC + Omni workflow state into UI-facing contracts.
   - Keeps Omni-specific behaviors explicit and testable.

## Initial slice plan

1. **O1**: Source audit + compatibility map.
2. **O2**: Adapter contracts (state/events/actions).
3. **O3**: Transcript/composer/commands adoption.
4. **O4**: Shell/session/sidebar adoption.
5. **O5**: Omni seam reintegration + exposure-rule hardening.

## Testing and verification focus

- `npm run check`
- `npm test`
- Manual standalone checks for transcript exposure, composer focus/flow, command UX, session behavior, provider recovery, and `.omni/` workflow visibility.

## Attribution policy

Any substantive copied/adapted code from OpenCode must include:
- source provenance comments where appropriate
- updates in `CREDITS.md`
- MIT license notice preservation
