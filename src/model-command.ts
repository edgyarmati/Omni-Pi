import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@mariozechner/pi-coding-agent";
import { getAgentDir } from "@mariozechner/pi-coding-agent";

import {
  refreshAuthenticatedProviderModelsWithDailyGuard,
  runModelSetupWizard,
} from "./model-setup.js";
import { searchableSelect } from "./searchable-select.js";

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

type CustomModelEntry = { provider: string; modelId: string };
type ListOption = { provider: string; modelId: string; label: string };

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

function getCustomModels(config: ModelsJsonConfig): CustomModelEntry[] {
  const entries: CustomModelEntry[] = [];
  for (const [provider, providerConfig] of Object.entries(
    config.providers ?? {},
  )) {
    for (const model of providerConfig.models ?? []) {
      entries.push({ provider, modelId: model.id });
    }
  }
  return entries;
}

export function removeCustomModelFromConfig(
  config: ModelsJsonConfig,
  provider: string,
  modelId: string,
): ModelsJsonConfig {
  const providers = { ...(config.providers ?? {}) };
  const providerConfig = providers[provider];
  if (!providerConfig?.models) {
    return {
      ...config,
      providers,
    };
  }

  providerConfig.models = providerConfig.models.filter(
    (model) => model.id !== modelId,
  );
  if (providerConfig.models.length === 0) {
    delete providers[provider];
  }

  return {
    ...config,
    providers,
  };
}

function buildListOptions(customModels: CustomModelEntry[]): ListOption[] {
  return customModels
    .map(({ provider, modelId }) => ({
      provider,
      modelId,
      label: `${provider}/${modelId}  ✕`,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

async function handleAdd(ctx: ExtensionCommandContext): Promise<void> {
  const result = await runModelSetupWizard({ ctx });
  ctx.ui.notify(result.summary, "info");
}

async function handleRefresh(ctx: ExtensionCommandContext): Promise<void> {
  const result = await refreshAuthenticatedProviderModelsWithDailyGuard(
    ctx.modelRegistry,
    { force: true },
  );

  if (result.refreshedProviders.length === 0) {
    ctx.ui.notify("No eligible custom providers were refreshed.", "info");
    return;
  }

  ctx.ui.notify(
    `Refreshed custom providers: ${result.refreshedProviders.join(", ")}.`,
    "info",
  );
}

async function handleList(ctx: ExtensionCommandContext): Promise<void> {
  const config = await readModelsJson();
  const custom = getCustomModels(config);
  const options = buildListOptions(custom);

  if (options.length === 0) {
    ctx.ui.notify("No custom models found.", "info");
    return;
  }

  while (true) {
    const selected = await searchableSelect(
      ctx.ui,
      "Custom models (✕ = remove):",
      options.map((option) => ({
        label: option.label,
        value: option.label,
        searchText: option.label.replace("✕", ""),
      })),
    );
    if (selected === undefined) return;
    const selectedOption = options.find((option) => option.label === selected);
    if (!selectedOption) continue;

    const modelRef = `${selectedOption.provider}/${selectedOption.modelId}`;
    const confirmed = await ctx.ui.confirm(
      "Remove model?",
      `Remove ${modelRef} from models.json?`,
    );
    if (!confirmed) return;

    const freshConfig = await readModelsJson();
    await writeModelsJson(
      removeCustomModelFromConfig(
        freshConfig,
        selectedOption.provider,
        selectedOption.modelId,
      ),
    );

    ctx.modelRegistry.refresh();
    ctx.ui.notify(`Removed ${modelRef}.`, "info");
    return;
  }
}

export function registerModelCommand(api: ExtensionAPI): void {
  api.registerCommand("model-setup", {
    description:
      "Add custom providers/models, refresh discovered models, or remove custom model entries",
    async handler(args: string, ctx: ExtensionCommandContext) {
      const sub = args.trim().toLowerCase();

      if (sub === "add") return handleAdd(ctx);
      if (sub === "refresh") return handleRefresh(ctx);
      if (sub === "list") return handleList(ctx);

      const choice = await searchableSelect(ctx.ui, "Model setup:", [
        {
          label: "add     — Add a custom provider or model",
          value: "add",
          searchText: "add custom provider model",
        },
        {
          label: "refresh — Re-discover models for configured custom providers",
          value: "refresh",
          searchText: "refresh rediscover custom provider models",
        },
        {
          label: "list    — Show custom models / remove model entries",
          value: "list",
          searchText: "list remove custom models",
        },
      ]);
      if (!choice) return;

      if (choice === "add") return handleAdd(ctx);
      if (choice === "refresh") return handleRefresh(ctx);
      if (choice === "list") return handleList(ctx);
    },
  });
}
