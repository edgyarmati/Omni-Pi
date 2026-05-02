import {
  formatOmniAgentsStatus,
  globalOmniSettingsPath,
  projectOmniSettingsPath,
  readEffectiveOmniAgentsSettings,
  readOmniRuntimeSettings,
  syncOmniSubagentRuntimeConfig,
  writeOmniAgentsSettings,
} from "./agent-settings.js";
import type { AppCommandDefinition } from "./pi.js";
import { executeRtkCommand } from "./rtk.js";
import { formatOmniModeStatus, readOmniMode, saveOmniMode } from "./theme.js";

async function executeOmniAgentsCommand(
  cwd: string,
  args: string[] = [],
): Promise<string> {
  const [action = "status", scopeFlag] = args;
  const projectScope = scopeFlag === "--project";
  const targetPath = projectScope
    ? projectOmniSettingsPath(cwd)
    : globalOmniSettingsPath();

  if (action === "status") {
    return formatOmniAgentsStatus(await readEffectiveOmniAgentsSettings(cwd));
  }
  if (action === "on" || action === "off") {
    const existing = await readOmniRuntimeSettings(targetPath);
    await writeOmniAgentsSettings(targetPath, {
      ...(existing.agents ?? {}),
      enabled: action === "on",
    });
    await syncOmniSubagentRuntimeConfig(cwd);
    const scope = projectScope ? "project" : "global";
    return `Omni optional subagents are now ${action === "on" ? "enabled" : "disabled"} in ${scope} settings. Restart or reload Pi for extension-level settings changes to take effect.`;
  }
  if (action === "setup") {
    return [
      "Omni optional subagents follow the single-writer invariant: the primary Omni brain writes code, decides scope, adjudicates reviews, commits, pushes, and opens PRs.",
      "Use `/omni-agents on` for global enablement or `/omni-agents on --project` for this project only.",
      "Configure models in ~/.omnicode/settings.json or .omnicode/settings.json under agents.defaultModel and agents.models for omni-explorer, omni-planner, and omni-verifier.",
    ].join("\n");
  }
  return "Usage: /omni-agents [status|on|off|setup] [--project]";
}

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
    {
      name: "omni-agents",
      description:
        "Configure optional read-only Omni subagents (status, setup, on, off)",
      async execute(context) {
        return await executeOmniAgentsCommand(context.cwd, context.args);
      },
    },
  ];
}
