import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import {
  buildBrainSystemPromptSuffix,
  ensureOmniInitialized,
} from "../../src/brain.js";
import { registerOmniMessageRenderer } from "../../src/pi.js";

export default function omniCoreExtension(api: ExtensionAPI): void {
  registerOmniMessageRenderer(api);

  api.on("session_start", async (_event, ctx) => {
    await ensureOmniInitialized(ctx.cwd);
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
