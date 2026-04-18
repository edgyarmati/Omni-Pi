import type { AppCommandDefinition } from "./pi.js";
import { executeRtkCommand } from "./rtk.js";
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
    {
      name: "omni-rtk",
      description:
        "Install RTK and control Omni's bash-side RTK routing (status, install, on, off)",
      async execute(context) {
        if (!context.runtime) {
          return "The /omni-rtk command is only available inside Omni-Pi interactive sessions.";
        }
        return await executeRtkCommand(context.args, context.runtime.ctx);
      },
    },
  ];
}
