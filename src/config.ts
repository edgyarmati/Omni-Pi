import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { OmniConfig } from "./contracts.js";
import { AVAILABLE_MODELS } from "./providers.js";

export const DEFAULT_CONFIG: OmniConfig = {
  models: {
    worker: "anthropic/claude-sonnet-4-6",
    expert: "openai/gpt-5.4",
    planner: "openai/gpt-5.4",
    brain: "anthropic/claude-opus-4-6",
  },
  retryLimit: 2,
  chainEnabled: false,
  cleanupCompletedPlans: false,
};

export const CONFIG_PATH = ".omni/CONFIG.md";

function parseModelTable(
  content: string,
  heading: string,
): Record<string, string> {
  const sectionRegex = new RegExp(
    `${heading}\\n\\n\\| Agent \\| Model \\|\\n\\|-+\\|-+\\|\\n([\\s\\S]*?)(?=\\n## |$)`,
    "u",
  );
  const match = content.match(sectionRegex);
  if (!match?.[1]) {
    return {};
  }

  const models: Record<string, string> = {};
  const lines = match[1].trim().split("\n");
  for (const line of lines) {
    const rowMatch = line.match(/\|\s*(\w+)\s*\|\s*([^|]+)\s*\|/u);
    if (rowMatch) {
      const agent = rowMatch[1].trim().toLowerCase();
      const model = rowMatch[2].trim();
      models[agent] = model;
    }
  }
  return models;
}

function parseRetryLimit(content: string): number {
  const match = content.match(
    /(?:Implementation retries before the plan must be tightened|Worker retries before expert takeover):\s*(\d+)/u,
  );
  return match ? Number.parseInt(match[1], 10) : DEFAULT_CONFIG.retryLimit;
}

function parseChainEnabled(content: string): boolean {
  const match = content.match(/Chain execution enabled:\s*(true|false)/u);
  return match ? match[1] === "true" : DEFAULT_CONFIG.chainEnabled;
}

function parseCleanupCompletedPlans(content: string): boolean {
  const match = content.match(/Delete completed plan files:\s*(true|false)/u);
  return match ? match[1] === "true" : DEFAULT_CONFIG.cleanupCompletedPlans;
}

export async function readConfig(rootDir: string): Promise<OmniConfig> {
  const configPath = path.join(rootDir, CONFIG_PATH);
  try {
    const content = await readFile(configPath, "utf8");
    const models = parseModelTable(content, "## Models");
    const retryLimit = parseRetryLimit(content);

    return {
      models: {
        worker: models.worker ?? DEFAULT_CONFIG.models.worker,
        expert: models.expert ?? DEFAULT_CONFIG.models.expert,
        planner: models.planner ?? DEFAULT_CONFIG.models.planner,
        brain: models.brain ?? DEFAULT_CONFIG.models.brain,
      },
      retryLimit,
      chainEnabled: parseChainEnabled(content),
      cleanupCompletedPlans: parseCleanupCompletedPlans(content),
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function renderConfigContent(config: OmniConfig): string {
  return `# Omni-Pi Configuration

## Models

| Agent | Model |
|-------|-------|
| worker | ${config.models.worker} |
| expert | ${config.models.expert} |
| planner | ${config.models.planner} |
| brain | ${config.models.brain} |

## Retry Policy

Implementation retries before the plan must be tightened: ${config.retryLimit}

## Execution

Chain execution enabled: ${config.chainEnabled}

## Memory

Delete completed plan files: ${config.cleanupCompletedPlans}
`;
}

export async function writeConfig(
  rootDir: string,
  config: OmniConfig,
): Promise<void> {
  const configPath = path.join(rootDir, CONFIG_PATH);
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, renderConfigContent(config), "utf8");
}

export async function updateModelConfig(
  rootDir: string,
  agent: string,
  model: string,
): Promise<OmniConfig> {
  const config = await readConfig(rootDir);
  const validAgents = ["worker", "expert", "planner", "brain"] as const;
  const normalizedAgent = agent.toLowerCase() as (typeof validAgents)[number];

  if (!validAgents.includes(normalizedAgent)) {
    throw new Error(
      `Invalid agent: ${agent}. Valid agents: ${validAgents.join(", ")}`,
    );
  }

  config.models[normalizedAgent] = model;
  await writeConfig(rootDir, config);
  return config;
}

export { AVAILABLE_MODELS };
