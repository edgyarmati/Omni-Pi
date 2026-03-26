import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import {
  buildBrainSystemPromptSuffix,
  ensureOmniInitialized,
} from "../../src/brain.js";
import { renderHeader } from "../../src/header.js";
import { registerModelCommand } from "../../src/model-command.js";
import { registerOmniMessageRenderer } from "../../src/pi.js";
import { createOmniTheme } from "../../src/theme.js";
import { registerThemeCommand } from "../../src/theme-command.js";

export default function omniCoreExtension(api: ExtensionAPI): void {
  registerOmniMessageRenderer(api);
  registerModelCommand(api);
  registerThemeCommand(api);

  api.on("session_start", async (_event, ctx) => {
    await ensureOmniInitialized(ctx.cwd);
    ctx.ui.setTitle("Omni-Pi");
    ctx.ui.setTheme(createOmniTheme());
    ctx.ui.setHeader((_tui, theme) => renderHeader(theme));
    ctx.ui.setStatus("omni", undefined);
  });

  api.on("before_agent_start", async (event, ctx) => {
    await ensureOmniInitialized(ctx.cwd);
    const brainPrompt = await buildBrainSystemPromptSuffix(ctx.cwd);

    return {
      systemPrompt: `${event.systemPrompt}\n\n${brainPrompt}`,
    };
  });
}
