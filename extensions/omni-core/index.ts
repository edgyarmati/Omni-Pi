import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import {
  buildBrainSystemPromptSuffix,
  ensureOmniInitialized,
  ensureOmniInitializedDetailed,
} from "../../src/brain.js";
import { renderHeader } from "../../src/header.js";
import { registerModelCommand } from "../../src/model-command.js";
import { registerOmniMessageRenderer } from "../../src/pi.js";
import { registerProviderAuthCommand } from "../../src/provider-auth-command.js";
import { createOmniTheme } from "../../src/theme.js";
import { registerThemeCommand } from "../../src/theme-command.js";
import { registerTodoShortcut } from "../../src/todo-shortcut.js";
import { registerUpdater } from "../../src/updater.js";
import { buildOnboardingInterviewKickoff } from "../../src/workflow.js";

export default function omniCoreExtension(api: ExtensionAPI): void {
  registerOmniMessageRenderer(api);
  registerModelCommand(api);
  registerProviderAuthCommand(api);
  registerThemeCommand(api);
  registerTodoShortcut(api);
  registerUpdater(api);

  api.on("session_start", async (_event, ctx) => {
    const init = await ensureOmniInitializedDetailed(ctx.cwd);
    ctx.ui.setTitle("Omni-Pi");
    ctx.ui.setTheme(createOmniTheme());
    ctx.ui.setHeader((_tui, theme) => renderHeader(theme));
    ctx.ui.setStatus("omni", "\x1b[2mctrl+shift+t tasks\x1b[0m");

    if (
      init.status === "initialized" &&
      init.initResult?.onboardingInterviewNeeded &&
      typeof api.sendUserMessage === "function"
    ) {
      ctx.ui.notify("Omni needs a short onboarding interview before planning.", "info");
      api.sendUserMessage(buildOnboardingInterviewKickoff(init.initResult));
    }
  });

  api.on("before_agent_start", async (event, ctx) => {
    await ensureOmniInitialized(ctx.cwd);
    const brainPrompt = await buildBrainSystemPromptSuffix(ctx.cwd);

    return {
      systemPrompt: `${event.systemPrompt}\n\n${brainPrompt}`,
    };
  });
}
