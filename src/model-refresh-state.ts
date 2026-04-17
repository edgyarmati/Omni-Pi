import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { getAgentDir } from "@mariozechner/pi-coding-agent";

export interface ModelRefreshState {
  lastSuccessfulRefreshDate?: string;
}

export function getModelRefreshStatePath(agentDir = getAgentDir()): string {
  return path.join(agentDir, "model-refresh-state.json");
}

export function getLocalDateStamp(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export async function readModelRefreshState(
  statePath = getModelRefreshStatePath(),
): Promise<ModelRefreshState> {
  try {
    const content = await readFile(statePath, "utf8");
    const parsed = JSON.parse(content) as ModelRefreshState;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export async function writeModelRefreshState(
  state: ModelRefreshState,
  statePath = getModelRefreshStatePath(),
): Promise<void> {
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}
