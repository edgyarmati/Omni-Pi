import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@mariozechner/pi-coding-agent";

import {
  getAuthenticatedModelOptions,
  setupCustomProviderModel,
} from "./model-setup.js";

async function handleAdd(ctx: ExtensionCommandContext): Promise<void> {
  const result = await setupCustomProviderModel({ ctx });
  ctx.ui.notify(result.summary, "info");
}

async function handleList(ctx: ExtensionCommandContext): Promise<void> {
  const models = getAuthenticatedModelOptions(ctx.modelRegistry);

  if (models.length === 0) {
    ctx.ui.notify("No models available.", "info");
    return;
  }

  await ctx.ui.select("Available models:", models);
}

export function registerModelCommand(api: ExtensionAPI): void {
  api.registerCommand("model-setup", {
    description: "Add or list custom model providers",
    async handler(args: string, ctx: ExtensionCommandContext) {
      const sub = args.trim().toLowerCase();

      if (sub === "add") return handleAdd(ctx);
      if (sub === "list") return handleList(ctx);

      const choice = await ctx.ui.select("Model setup:", [
        "add    — Add a custom provider/model",
        "list   — Show available models",
      ]);
      if (!choice) return;

      const picked = choice.split("—")[0].trim();
      if (picked === "add") return handleAdd(ctx);
      if (picked === "list") return handleList(ctx);
    },
  });
}
