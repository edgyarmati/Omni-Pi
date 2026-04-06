import type { AppCommandDefinition } from "./pi.js";
import { formatOmniModeStatus, readOmniMode, saveOmniMode } from "./theme.js";

export function createOmniCommands(): AppCommandDefinition[] {
  return [
    {
      name: "omni-mode",
      description: "Toggle Omni mode on or off for this project",
      async execute(context) {
        const enabled = !readOmniMode(context.cwd);
        saveOmniMode(context.cwd, enabled);
        context.runtime?.ctx.ui.setStatus(
          "omni",
          formatOmniModeStatus(enabled),
        );
        if (!enabled) {
          context.runtime?.ctx.ui.setWidget("omni-dashboard", undefined);
          context.runtime?.ctx.ui.setWidget("omni-todos", undefined);
        }
        return enabled
          ? "Omni mode is now ON. The next agent turn will initialize or refresh .omni/ and use the full Omni workflow."
          : "Omni mode is now OFF. Omni will keep using durable standards from .omni/ when present, but task workflow state is disabled.";
      },
    },
  ];
}
