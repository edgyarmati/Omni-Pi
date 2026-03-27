import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@mariozechner/pi-coding-agent";
import { getAgentDir } from "@mariozechner/pi-coding-agent";

import {
  getAuthenticatedModelOptions,
  setupCustomProviderModel,
} from "./model-setup.js";

interface ModelsJsonModel {
  id: string;
  [key: string]: unknown;
}

interface ModelsJsonProvider {
  models?: ModelsJsonModel[];
  [key: string]: unknown;
}

interface ModelsJsonConfig {
  providers?: Record<string, ModelsJsonProvider>;
}

function getModelsPath(): string {
  return path.join(getAgentDir(), "models.json");
}

async function readModelsJson(): Promise<ModelsJsonConfig> {
  try {
    const content = await readFile(getModelsPath(), "utf8");
    const parsed = JSON.parse(content) as ModelsJsonConfig;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

async function writeModelsJson(config: ModelsJsonConfig): Promise<void> {
  const modelsPath = getModelsPath();
  await mkdir(path.dirname(modelsPath), { recursive: true });
  await writeFile(modelsPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function getCustomModels(
  config: ModelsJsonConfig,
): Array<{ provider: string; modelId: string }> {
  const entries: Array<{ provider: string; modelId: string }> = [];
  for (const [provider, providerConfig] of Object.entries(
    config.providers ?? {},
  )) {
    for (const model of providerConfig.models ?? []) {
      entries.push({ provider, modelId: model.id });
    }
  }
  return entries;
}

async function handleAdd(ctx: ExtensionCommandContext): Promise<void> {
  const result = await setupCustomProviderModel({ ctx });
  ctx.ui.notify(result.summary, "info");
}

async function handleList(ctx: ExtensionCommandContext): Promise<void> {
  const config = await readModelsJson();
  const custom = getCustomModels(config);
  const all = getAuthenticatedModelOptions(ctx.modelRegistry);

  const customRefs = new Set(custom.map((c) => `${c.provider}/${c.modelId}`));
  const options = all.map((model) =>
    customRefs.has(model) ? `${model}  ✕` : model,
  );

  if (options.length === 0) {
    ctx.ui.notify("No models available.", "info");
    return;
  }

  // Loop until user picks a custom model or cancels
  while (true) {
    const selected = await ctx.ui.select(
      "Available models (✕ = remove):",
      options,
    );
    if (selected === undefined) return;
    if (!selected.endsWith("✕")) continue;

    const modelRef = selected.replace(/\s+✕$/, "");
    const confirmed = await ctx.ui.confirm(
      "Remove model?",
      `Remove ${modelRef} from models.json?`,
    );
    if (!confirmed) return;

    const [provider, ...rest] = modelRef.split("/");
    const modelId = rest.join("/");

    const freshConfig = await readModelsJson();
    const providers = freshConfig.providers ?? {};
    const providerConfig = providers[provider];
    if (providerConfig?.models) {
      providerConfig.models = providerConfig.models.filter(
        (m) => m.id !== modelId,
      );
      if (providerConfig.models.length === 0) {
        delete providers[provider];
      }
    }
    freshConfig.providers = providers;
    await writeModelsJson(freshConfig);

    ctx.modelRegistry.refresh();
    ctx.ui.notify(`Removed ${modelRef}.`, "info");
    return;
  }
}

export function registerModelCommand(api: ExtensionAPI): void {
  api.registerCommand("model-setup", {
    description: "Add, list, or remove custom model providers",
    async handler(args: string, ctx: ExtensionCommandContext) {
      const sub = args.trim().toLowerCase();

      if (sub === "add") return handleAdd(ctx);
      if (sub === "list") return handleList(ctx);

      const choice = await ctx.ui.select("Model setup:", [
        "add    — Add a custom provider/model",
        "list   — Show available models / remove custom",
      ]);
      if (!choice) return;

      const picked = choice.split("—")[0].trim();
      if (picked === "add") return handleAdd(ctx);
      if (picked === "list") return handleList(ctx);
    },
  });
}
