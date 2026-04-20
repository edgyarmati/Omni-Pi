# Standalone Omni app architecture

This document defines the migration boundary for Omni's standalone app track on `feat/opentui-standalone-omni`.

## Goal

Move Omni from a Pi-package-owned terminal UI to an Omni-owned app shell, while keeping Pi as the execution engine over RPC.

## Architecture contract

### Engine boundary

The standalone app must treat Pi as an external engine process.

- Omni launches Pi in RPC mode as a subprocess.
- Communication uses strict JSONL over stdin/stdout.
- Omni owns request correlation, event parsing, extension UI mapping, and process lifecycle.
- Omni app code should not depend on Pi's `@mariozechner/pi-tui` components.

### UI boundary

The standalone app owns:

- layout and rendering
- input/editor UX
- sidebar and panel coordination
- notifications, dialogs, and overlays
- app-level keyboard shortcuts
- model/session/task controls exposed to the user

Pi extension UI requests are inputs to Omni's UI layer, not authoritative layout instructions.

### Shared-logic boundary

These categories should remain reusable across legacy and standalone paths where practical:

- durable `.omni/` workflow logic
- repo-map prompt/runtime logic
- provider/model setup logic
- project memory/context helpers
- planning/execution/check orchestration helpers that are not Pi-TUI-specific

These categories should move out of legacy extension files over time:

- widget rendering
- header/footer/status layout assumptions
- direct `@mariozechner/pi-tui` composition for Omni-owned product UI

## Target package layout

```text
bin/
  omni.js                 # current launcher; legacy during migration
src/
  standalone/
    index.ts              # standalone app exports / composition root boundary
    contracts.ts          # app-level state and view contracts
    app-shell.ts          # shell factory boundary (OpenTUI later)
    rpc/
      contracts.ts        # typed RPC command/event contracts used by Omni
      client.ts           # subprocess + request/response/event adapter
      framing.ts          # strict JSONL framing helpers
    state/
      conversation.ts     # conversation view-model state
      workflow.ts         # .omni/task/sidebar state
      session.ts          # model/session/queue state
    ui/
      layout.ts           # high-level panel/layout contracts
      panels/             # sidebar/content panel components
      dialogs/            # app-owned dialogs
extensions/
  ...                     # legacy Pi-package path remains during migration
```

Not every file above exists yet. This tree is the intended boundary map for upcoming slices.

## Runtime note

The current standalone preview uses **Bun** to launch the OpenTUI shell.

Why:

- `@opentui/core` installs from npm successfully in this repo
- but direct Node ESM execution still hits asset-loading issues here (`.scm` tree-sitter highlight assets)
- Bun can run the OpenTUI shell successfully today, so the migration keeps Node for the legacy Pi-package path while using Bun for the standalone preview runtime

This is an implementation detail of the current migration stage, not a permanent product promise.

## Migration policy

### Legacy compatibility

During migration:

- the current Pi-package launcher remains supported
- new UI investment goes into the standalone app track
- shared non-UI logic should be extracted rather than duplicated where feasible

### Attribution

If code is copied or substantively adapted from MIT-licensed projects such as OpenCode:

- keep a source comment near the adapted code
- record the provenance in `CREDITS.md`
- note meaningful modifications when practical

## First milestones

1. Define boundaries and compile-safe modules for the standalone track.
2. Build the RPC subprocess client and strict JSONL parser.
3. Build a conversation-first OpenTUI shell.
4. Add workflow side panels for `.omni/` state and repo-map context.
5. Add session/model/queue controls.

## Explicit non-goals for M1

- shipping the real OpenTUI app
- removing the legacy Pi-package UI
- fully translating all extension UI requests yet
- deciding the final GUI-client packaging strategy
