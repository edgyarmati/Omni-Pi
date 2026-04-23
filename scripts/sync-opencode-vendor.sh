#!/usr/bin/env bash
set -euo pipefail

UPSTREAM_ROOT="${1:-/tmp/pi-github-repos/anomalyco/opencode}"
SRC="$UPSTREAM_ROOT/packages/opencode/src/cli/cmd/tui"
DEST="vendor/opencode-tui"

if [[ ! -d "$SRC" ]]; then
  echo "Upstream TUI path not found: $SRC" >&2
  exit 1
fi

mkdir -p "$DEST/component/prompt" "$DEST/routes/session" "$DEST/ui" "$DEST/context" "$DEST/plugin" "$DEST/util" "$DEST/feature-plugins/sidebar"

copy() {
  local rel="$1"
  mkdir -p "$DEST/$(dirname "$rel")"
  cp "$SRC/$rel" "$DEST/$rel"
}

copy "app.tsx"
copy "component/dialog-command.tsx"
copy "component/prompt/index.tsx"
copy "routes/home.tsx"
copy "routes/session/index.tsx"
copy "routes/session/sidebar.tsx"
copy "ui/dialog.tsx"
copy "ui/dialog-select.tsx"
copy "ui/dialog-prompt.tsx"
copy "ui/dialog-confirm.tsx"
copy "ui/dialog-help.tsx"
copy "ui/toast.tsx"
copy "context/route.tsx"
copy "context/keybind.tsx"
copy "context/theme.tsx"
copy "plugin/index.ts"
copy "util/model.ts"
copy "feature-plugins/sidebar/context.tsx"
copy "feature-plugins/sidebar/files.tsx"
copy "feature-plugins/sidebar/footer.tsx"
copy "feature-plugins/sidebar/lsp.tsx"
copy "feature-plugins/sidebar/mcp.tsx"
copy "feature-plugins/sidebar/todo.tsx"

REV=$(git -C "$UPSTREAM_ROOT" rev-parse HEAD 2>/dev/null || true)
if [[ -n "$REV" ]]; then
  echo "Synced OpenCode TUI snapshot from commit: $REV"
else
  echo "Synced OpenCode TUI snapshot from non-git source: $UPSTREAM_ROOT"
fi
