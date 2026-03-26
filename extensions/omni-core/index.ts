import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import {
  buildBrainSystemPromptSuffix,
  ensureOmniInitialized,
} from "../../src/brain.js";
import { registerOmniMessageRenderer } from "../../src/pi.js";

export default function omniCoreExtension(api: ExtensionAPI): void {
  registerOmniMessageRenderer(api);

  api.on("session_start", async (_event, ctx) => {
    const initStatus = await ensureOmniInitialized(ctx.cwd);

    api.sendMessage({
      customType: "omni-status",
      content:
        initStatus === "initialized"
          ? "Single-brain mode is active. Omni-Pi created its .omni/ memory for this project. Describe what you want to build or change, and the agent will interview you before implementing."
          : "Single-brain mode is active. Describe what you want to build or change, and the agent will interview you before implementing.",
      display: true,
      details: {
        title: "Omni-Pi Brain",
        phase: "understand",
        activeTask: "Capture exact requirements",
        nextStep: "Describe the requested behavior in plain language.",
      },
    });
  });

  api.on("before_agent_start", async (event, ctx) => {
    await ensureOmniInitialized(ctx.cwd);
    const brainPrompt = await buildBrainSystemPromptSuffix(ctx.cwd);

    return {
      systemPrompt: `${event.systemPrompt}\n\n${brainPrompt}`,
    };
  });
}
