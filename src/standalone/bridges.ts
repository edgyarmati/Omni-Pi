import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  SessionManager,
  type SessionInfo,
} from "../../node_modules/@mariozechner/pi-coding-agent/dist/core/session-manager.js";

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

async function execFileAsync(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    execFile(command, args, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
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
