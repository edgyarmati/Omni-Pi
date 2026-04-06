import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import {
  buildPassiveOmniPromptSuffix,
  buildWorkflowPromptSuffix,
  ensureOmniReady,
} from "../../src/brain.js";
import { createOmniCommands } from "../../src/commands.js";
import { renderHeader } from "../../src/header.js";
import { registerModelCommand } from "../../src/model-command.js";
import {
  registerOmniMessageRenderer,
  registerPiCommands,
} from "../../src/pi.js";
import { registerProviderAuthCommand } from "../../src/provider-auth-command.js";
import {
  createOmniTheme,
  ensurePiSettings,
  formatOmniModeStatus,
  loadSavedTheme,
  readOmniMode,
} from "../../src/theme.js";
import { registerThemeCommand } from "../../src/theme-command.js";
import { registerTodoShortcut } from "../../src/todo-shortcut.js";
import { registerUpdater } from "../../src/updater.js";
import { buildOnboardingInterviewKickoff } from "../../src/workflow.js";

export default function omniCoreExtension(api: ExtensionAPI): void {
  registerOmniMessageRenderer(api);
  registerPiCommands(api, createOmniCommands());
  registerModelCommand(api);
  registerProviderAuthCommand(api);
  registerThemeCommand(api);
  registerTodoShortcut(api);
  registerUpdater(api);

  api.on("session_start", async (_event, ctx) => {
    await ensurePiSettings(ctx.cwd);
    loadSavedTheme(ctx.cwd);
    const omniMode = readOmniMode(ctx.cwd);
    ctx.ui.setTitle("Omni-Pi");
    ctx.ui.setTheme(createOmniTheme());
    ctx.ui.setHeader((_tui, theme) => renderHeader(theme));
    ctx.ui.setStatus("omni", formatOmniModeStatus(omniMode));
  });

  api.on("before_agent_start", async (event, ctx) => {
    const omniMode = readOmniMode(ctx.cwd);
    const passivePrompt = await buildPassiveOmniPromptSuffix(ctx.cwd);
    if (!omniMode) {
      return {
        systemPrompt: [event.systemPrompt, passivePrompt]
          .filter(Boolean)
          .join("\n\n"),
      };
    }

    const init = await ensureOmniReady(ctx.cwd, {
      ui: "ui" in ctx ? ctx.ui : undefined,
    });
    const workflowPrompt = await buildWorkflowPromptSuffix(ctx.cwd);
    const onboardingKickoff = init.initResult?.onboardingInterviewNeeded
      ? buildOnboardingInterviewKickoff(init.initResult)
      : "";
    const prompt = [
      event.systemPrompt,
      passivePrompt,
      workflowPrompt,
      onboardingKickoff,
    ]
      .filter(Boolean)
      .join("\n\n");

    if (init.initResult?.standardsPromptNeeded) {
      api.sendMessage({
        customType: "omni-update",
        content:
          "Omni found external instruction files that can be imported into .omni/STANDARDS.md. Please confirm in chat whether Omni should keep those standards.",
        display: true,
        details: { title: "omni-mode" },
      });
    }

    return {
      systemPrompt: prompt,
    };
  });
}
