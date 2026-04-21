import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getAgentDir } from "@mariozechner/pi-coding-agent";

import { AuthStorage } from "../../node_modules/@mariozechner/pi-coding-agent/dist/core/auth-storage.js";
import {
  SessionManager,
  type SessionInfo,
} from "../../node_modules/@mariozechner/pi-coding-agent/dist/core/session-manager.js";
import { getKnownProviderSetups } from "../model-setup.js";

export interface StandaloneDialogOption {
  label: string;
  value: string;
  searchText?: string;
  detail?: string;
}

export interface StandaloneScopedModelOption extends StandaloneDialogOption {
  provider: string;
  modelId: string;
}

interface PiSettingsFile {
  enabledModels?: string[];
  [key: string]: unknown;
}

interface ModelsJsonProviderConfig {
  apiKey?: string;
  models?: Array<{ id: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

interface ModelsJsonConfig {
  providers?: Record<string, ModelsJsonProviderConfig>;
}

interface AuthCredential {
  type: "api_key" | "oauth";
}

export interface StandaloneProviderStatus {
  id: string;
  label: string;
  auth: "api-key" | "oauth";
  connected: boolean;
  configured: boolean;
  availableModelCount: number;
}

export interface StandaloneProviderOverview {
  items: StandaloneProviderStatus[];
  connectedProviderCount: number;
  configuredProviderCount: number;
  availableModelCount: number;
  enabledModelCount: number;
  hasAnyOAuthProvider: boolean;
  recommendedAction?: string;
  summary?: string;
}

export function getOmniPackageDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
}

export async function readOmniChangelog(): Promise<string> {
  const changelogPath = path.join(getOmniPackageDir(), "CHANGELOG.md");
  return readFile(changelogPath, "utf8");
}

function getProjectSettingsPath(cwd: string): string {
  return path.join(cwd, ".pi", "settings.json");
}

async function readProjectSettings(cwd: string): Promise<PiSettingsFile> {
  try {
    const content = await readFile(getProjectSettingsPath(cwd), "utf8");
    const parsed = JSON.parse(content) as PiSettingsFile;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

async function writeProjectSettings(
  cwd: string,
  settings: PiSettingsFile,
): Promise<void> {
  const settingsPath = getProjectSettingsPath(cwd);
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

export async function readEnabledModels(cwd: string): Promise<string[]> {
  const settings = await readProjectSettings(cwd);
  return Array.isArray(settings.enabledModels)
    ? settings.enabledModels.filter((value): value is string => typeof value === "string")
    : [];
}

export async function writeEnabledModels(
  cwd: string,
  enabledModels: string[] | undefined,
): Promise<void> {
  const settings = await readProjectSettings(cwd);
  if (enabledModels === undefined || enabledModels.length === 0) {
    delete settings.enabledModels;
  } else {
    settings.enabledModels = [...enabledModels];
  }
  await writeProjectSettings(cwd, settings);
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

export async function getProviderOverview(options?: {
  availableModels?: Array<{ provider?: string; id?: string; name?: string }>;
  enabledModels?: string[];
}): Promise<StandaloneProviderOverview> {
  const [config, enabledModels] = await Promise.all([
    readModelsJson(),
    options?.enabledModels ? Promise.resolve(options.enabledModels) : Promise.resolve([]),
  ]);
  const authStorage = AuthStorage.create() as {
    list(): string[];
    get(provider: string): AuthCredential | undefined;
    getOAuthProviders(): Array<{ id: string; name?: string }>;
  };
  const connectedProviders = new Set(authStorage.list());
  const configuredProviders = new Set(Object.keys(config.providers ?? {}));
  const availableByProvider = new Map<string, number>();
  for (const model of options?.availableModels ?? []) {
    if (!model.provider) continue;
    availableByProvider.set(
      model.provider,
      (availableByProvider.get(model.provider) ?? 0) + 1,
    );
  }

  const known = getKnownProviderSetups();
  const knownIds = new Set(known.map((entry) => entry.id));
  const customConfigured = [...configuredProviders].filter((id) => !knownIds.has(id));

  const items: StandaloneProviderStatus[] = [
    ...known.map((provider) => ({
      id: provider.id,
      label: provider.label,
      auth: provider.auth,
      connected:
        connectedProviders.has(provider.id) ||
        Boolean(config.providers?.[provider.id]?.apiKey?.trim()),
      configured: configuredProviders.has(provider.id),
      availableModelCount: availableByProvider.get(provider.id) ?? 0,
    })),
    ...customConfigured.map((providerId) => ({
      id: providerId,
      label: providerId,
      auth: "api-key" as const,
      connected:
        connectedProviders.has(providerId) ||
        Boolean(config.providers?.[providerId]?.apiKey?.trim()),
      configured: true,
      availableModelCount: availableByProvider.get(providerId) ?? 0,
    })),
  ].sort((left, right) => {
    const rightScore = Number(right.availableModelCount > 0) * 4 + Number(right.connected) * 2 + Number(right.configured);
    const leftScore = Number(left.availableModelCount > 0) * 4 + Number(left.connected) * 2 + Number(left.configured);
    return rightScore - leftScore || left.label.localeCompare(right.label);
  });

  const connectedProviderCount = items.filter((item) => item.connected).length;
  const configuredProviderCount = items.filter((item) => item.configured).length;
  const availableModelCount = [...availableByProvider.values()].reduce((sum, count) => sum + count, 0);
  const enabledModelCount = enabledModels.length;
  const hasAnyOAuthProvider = authStorage.getOAuthProviders().length > 0;

  const recommendedAction =
    availableModelCount > 0
      ? undefined
      : connectedProviderCount > 0 || configuredProviderCount > 0
        ? "/providers → refresh models"
        : hasAnyOAuthProvider
          ? "/providers → connect provider"
          : "/providers → add custom provider";

  const summary =
    availableModelCount > 0
      ? `${availableModelCount} available model${availableModelCount === 1 ? "" : "s"} across ${Math.max(1, items.filter((item) => item.availableModelCount > 0).length)} provider${items.filter((item) => item.availableModelCount > 0).length === 1 ? "" : "s"}`
      : connectedProviderCount > 0 || configuredProviderCount > 0
        ? "Providers are configured, but no models are currently available."
        : "No providers are connected yet.";

  return {
    items,
    connectedProviderCount,
    configuredProviderCount,
    availableModelCount,
    enabledModelCount,
    hasAnyOAuthProvider,
    recommendedAction,
    summary,
  };
}

function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMins < 1) return "now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

function trimOneLine(value: string, max = 72): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function toSessionOption(session: SessionInfo): StandaloneDialogOption {
  const title = session.name?.trim() || trimOneLine(session.firstMessage || "Untitled session", 64);
  const detail = [
    session.cwd || "unknown cwd",
    `${session.messageCount} msg`,
    formatRelativeTime(session.modified),
  ].join("  ·  ");

  return {
    label: title,
    value: session.path,
    searchText: [
      session.name,
      session.firstMessage,
      session.allMessagesText,
      session.cwd,
      session.path,
      session.id,
    ]
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .join(" "),
    detail,
  };
}

export async function listSessionOptions(cwd: string): Promise<StandaloneDialogOption[]> {
  const sessions = await SessionManager.listAll();
  return sessions
    .sort(
      (left: SessionInfo, right: SessionInfo) =>
        right.modified.getTime() - left.modified.getTime(),
    )
    .map((session: SessionInfo) => toSessionOption(session))
    .map((option: StandaloneDialogOption) => ({
      ...option,
      detail:
        option.detail && option.searchText?.includes(cwd)
          ? `${option.detail}  ·  current project`
          : option.detail,
    }));
}

async function execFileAsync(
  command: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number }> {
  return await new Promise<{ stdout: string; stderr: string; code: number }>(
    (resolve, reject) => {
      const child = execFile(command, args, { encoding: "utf-8" }, (error, stdout, stderr) => {
        if (error && typeof error.code !== "number") {
          reject(error);
          return;
        }
        resolve({ stdout: stdout ?? "", stderr: stderr ?? "", code: (typeof error?.code === "number" ? error.code : 0) as number });
      });
      child.stdin?.end();
    },
  );
}

export async function getGhAuthStatus(): Promise<boolean> {
  try {
    const result = await execFileAsync("gh", ["auth", "status"]);
    return result.code === 0;
  } catch {
    return false;
  }
}

export async function createSecretGist(
  filePath: string,
): Promise<{ gistUrl: string; gistId: string }> {
  const result = await execFileAsync("gh", ["gist", "create", "--public=false", filePath]);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || "Failed to create gist");
  }
  const gistUrl = result.stdout.trim();
  const gistId = gistUrl.split("/").pop() ?? "";
  if (!gistId) {
    throw new Error("Failed to parse gist ID from gh output");
  }
  return { gistUrl, gistId };
}

export function getShareViewerUrl(gistId: string): string {
  const baseUrl =
    process.env.PI_SHARE_VIEWER_URL || "https://pi.dev/session/";
  return `${baseUrl}#${gistId}`;
}

export async function openExternalUrl(url: string): Promise<void> {
  if (process.platform === "darwin") {
    await execFileAsync("open", [url]);
    return;
  }
  if (process.platform === "win32") {
    await execFileAsync("cmd", ["/c", "start", "", url]);
    return;
  }
  await execFileAsync("xdg-open", [url]);
}

export async function copyTextToClipboard(text: string): Promise<void> {
  if (process.platform === "darwin") {
    await new Promise<void>((resolve, reject) => {
      const child = execFile("pbcopy", (error) => {
        if (error) reject(error);
        else resolve();
      });
      child.stdin?.end(text);
    });
    return;
  }

  if (process.platform === "win32") {
    await new Promise<void>((resolve, reject) => {
      const child = execFile("clip", (error) => {
        if (error) reject(error);
        else resolve();
      });
      child.stdin?.end(text);
    });
    return;
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const child = execFile("wl-copy", (error) => {
        if (error) reject(error);
        else resolve();
      });
      child.stdin?.end(text);
    });
    return;
  } catch {
    await new Promise<void>((resolve, reject) => {
      const child = execFile("xclip", ["-selection", "clipboard"], (error) => {
        if (error) reject(error);
        else resolve();
      });
      child.stdin?.end(text);
    });
  }
}
