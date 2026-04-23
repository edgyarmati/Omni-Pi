# OpenCode TUI Upstream Snapshot

This directory contains vendored source snapshots from OpenCode TUI for adaptation into Omni standalone.

- Upstream repo: https://github.com/anomalyco/opencode
- Upstream path: `packages/opencode/src/cli/cmd/tui/`
- Snapshot commit: `9b6db08d2144c33ec34cd88026774f847ec79761`
- Snapshot date: 2026-04-23
- License: MIT (see upstream `LICENSE`)

## Included files

- `app.tsx`
- `component/dialog-command.tsx`
- `component/prompt/index.tsx`
- `routes/home.tsx`
- `routes/session/index.tsx`
- `routes/session/sidebar.tsx`
- `ui/dialog.tsx`
- `ui/dialog-select.tsx`
- `ui/dialog-prompt.tsx`
- `ui/dialog-confirm.tsx`
- `ui/dialog-help.tsx`
- `ui/toast.tsx`
- `context/route.tsx`
- `context/keybind.tsx`
- `context/theme.tsx`
- `plugin/index.ts`
- `util/model.ts`
- `feature-plugins/sidebar/*`

## Notes

These files are intentionally vendored for **behavior-first porting**.
They are not yet runtime-wired directly; Omni adapts them incrementally through the Pi-RPC adapter boundary.
