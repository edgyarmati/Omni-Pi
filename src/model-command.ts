import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@mariozechner/pi-coding-agent";
import { getAgentDir } from "@mariozechner/pi-coding-agent";

import { runModelSetupWizard } from "./model-setup.js";
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
type ListOption =
  | { kind: "provider"; provider: string; label: string }
  | { kind: "model"; provider: string; modelId: string; label: string }
  | { kind: "plain"; label: string };

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

function getCustomProviders(config: ModelsJsonConfig): string[] {
  return Object.keys(config.providers ?? {}).sort((left, right) =>
    left.localeCompare(right),
  );
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

export function removeCustomProviderFromConfig(
  config: ModelsJsonConfig,
  provider: string,
): ModelsJsonConfig {
  const providers = { ...(config.providers ?? {}) };
  delete providers[provider];
  return {
    ...config,
    providers,
  };
}

function buildListOptions(
  customModels: CustomModelEntry[],
  customProviders: string[],
): ListOption[] {
  return [
    ...customProviders.map((provider) => ({
      kind: "provider" as const,
      provider,
      label: `${provider}  ⌫ provider`,
    })),
    ...customModels
      .map(({ provider, modelId }) => ({
        kind: "model" as const,
        provider,
        modelId,
        label: `${provider}/${modelId}  ✕`,
      }))
      .sort((left, right) => left.label.localeCompare(right.label)),
  ];
}

async function handleAdd(ctx: ExtensionCommandContext): Promise<void> {
  const result = await runModelSetupWizard({ ctx });
  ctx.ui.notify(result.summary, "info");
}

async function handleList(ctx: ExtensionCommandContext): Promise<void> {
  const config = await readModelsJson();
  const custom = getCustomModels(config);
  const customProviders = getCustomProviders(config);
  const options = buildListOptions(custom, customProviders);

  if (options.length === 0) {
    ctx.ui.notify("No custom providers or models found.", "info");
    return;
  }

  while (true) {
    const selected = await searchableSelect(
      ctx.ui,
      "Custom providers and models (✕ = remove model, ⌫ = remove provider):",
      options.map((option) => ({
        label: option.label,
        value: option.label,
        searchText: option.label.replace("✕", "").replace("⌫ provider", ""),
      })),
    );
    if (selected === undefined) return;
    const selectedOption = options.find((option) => option.label === selected);
    if (!selectedOption || selectedOption.kind === "plain") continue;

    if (selectedOption.kind === "provider") {
      const confirmed = await ctx.ui.confirm(
        "Remove provider?",
        `Remove custom provider ${selectedOption.provider} and all of its models from models.json?`,
      );
      if (!confirmed) return;

      const freshConfig = await readModelsJson();
      await writeModelsJson(
        removeCustomProviderFromConfig(freshConfig, selectedOption.provider),
      );

      ctx.modelRegistry.refresh();
      ctx.ui.notify(`Removed provider ${selectedOption.provider}.`, "info");
      return;
    }

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
    description: "Add, list, or remove custom providers and models",
    async handler(args: string, ctx: ExtensionCommandContext) {
      const sub = args.trim().toLowerCase();

      if (sub === "add") return handleAdd(ctx);
      if (sub === "list") return handleList(ctx);

      const choice = await searchableSelect(ctx.ui, "Model setup:", [
        {
          label: "add    — Add a custom provider or model",
          value: "add",
          searchText: "add custom provider model",
        },
        {
          label: "list   — Show custom providers/models / remove custom",
          value: "list",
          searchText: "list remove custom providers models",
        },
      ]);
      if (!choice) return;

      if (choice === "add") return handleAdd(ctx);
      if (choice === "list") return handleList(ctx);
    },
  });
}
