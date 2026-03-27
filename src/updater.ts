import { execFile as execFileCb } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";

const PACKAGE_NAME = "omni-pi";
const CACHE_DIR = path.join(process.env.HOME ?? "~", ".omni");
const CACHE_PATH = path.join(CACHE_DIR, "update-cache.json");
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

interface UpdateCache {
  latestVersion: string;
  checkedAt: number;
  dismissedVersion?: string;
}

function readOwnVersion(): string {
  try {
    const pkgPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "package.json",
    );
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      version?: string;
    };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function readCache(): UpdateCache | null {
  try {
    return JSON.parse(readFileSync(CACHE_PATH, "utf8")) as UpdateCache;
  } catch {
    return null;
  }
}

async function writeCache(cache: UpdateCache): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), "utf8");
}

function isNewer(latest: string, current: string): boolean {
  const parse = (v: string) => v.split(".").map(Number);
  const [lMaj, lMin, lPat] = parse(latest);
  const [cMaj, cMin, cPat] = parse(current);
  if (lMaj !== cMaj) return lMaj > cMaj;
  if (lMin !== cMin) return lMin > cMin;
  return lPat > cPat;
}

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(
      `https://registry.npmjs.org/${PACKAGE_NAME}/latest`,
      { signal: controller.signal },
    );
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  }
}

async function checkAndCache(): Promise<string | null> {
  const current = readOwnVersion();
  const cache = readCache();

  // If we checked recently and have a cached version, use it
  if (cache && Date.now() - cache.checkedAt < CHECK_INTERVAL_MS) {
    if (
      isNewer(cache.latestVersion, current) &&
      cache.dismissedVersion !== cache.latestVersion
    ) {
      return cache.latestVersion;
    }
    return null;
  }

  // Fetch fresh
  const latest = await fetchLatestVersion();
  if (!latest) return null;

  await writeCache({
    latestVersion: latest,
    checkedAt: Date.now(),
    dismissedVersion: cache?.dismissedVersion,
  });

  if (isNewer(latest, current) && cache?.dismissedVersion !== latest) {
    return latest;
  }
  return null;
}

function runNpmInstall(
  version: string,
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    execFileCb(
      "npm",
      ["install", "-g", `${PACKAGE_NAME}@${version}`],
      { timeout: 120_000 },
      (err, _stdout, stderr) => {
        if (err && "code" in err) {
          resolve({
            code: (err as { code: number }).code,
            stderr: stderr ?? "",
          });
          return;
        }
        if (err) {
          resolve({ code: 1, stderr: err.message });
          return;
        }
        resolve({ code: 0, stderr: "" });
      },
    );
  });
}

async function doInstall(
  version: string,
  ctx: ExtensionContext,
): Promise<boolean> {
  ctx.ui.notify(`Installing ${PACKAGE_NAME}@${version}...`, "info");
  const result = await runNpmInstall(version);
  if (result.code === 0) {
    ctx.ui.notify(
      `Updated to ${PACKAGE_NAME}@${version}. Restart omni to apply.`,
      "info",
    );
    return true;
  }
  ctx.ui.notify(`Update failed: ${result.stderr}`, "error");
  return false;
}

async function promptUpdate(
  version: string,
  ctx: ExtensionContext,
): Promise<void> {
  const current = readOwnVersion();
  const updateLabel = `Update now (npm install -g ${PACKAGE_NAME}@${version})`;
  const skipLabel = "Skip";
  const dismissLabel = "Skip this version";
  const choice = await ctx.ui.select(
    `Omni-Pi update available: ${current} → ${version}`,
    [updateLabel, skipLabel, dismissLabel],
  );

  if (choice === updateLabel) {
    const success = await doInstall(version, ctx);
    if (success) {
      const restart = await ctx.ui.confirm(
        "Restart omni?",
        "The update has been installed.",
      );
      if (restart) {
        ctx.shutdown();
      }
    }
  } else if (choice === dismissLabel) {
    const cache = readCache();
    if (cache) {
      await writeCache({ ...cache, dismissedVersion: version });
    }
    ctx.ui.notify(`Skipped version ${version}`, "info");
  }
}

export function registerUpdater(api: ExtensionAPI): void {
  // Suppress Pi's own version check
  process.env.PI_SKIP_VERSION_CHECK = "1";

  api.on("session_start", async (_event, ctx) => {
    const newVersion = await checkAndCache();
    if (newVersion) {
      await promptUpdate(newVersion, ctx);
    }
  });

  api.registerCommand("update", {
    description: "Check for Omni-Pi updates",
    async handler(_args, ctx) {
      ctx.ui.notify("Checking for updates...", "info");
      // Force a fresh check
      const latest = await fetchLatestVersion();
      if (!latest) {
        ctx.ui.notify("Could not reach npm registry", "error");
        return;
      }
      const current = readOwnVersion();
      if (isNewer(latest, current)) {
        await promptUpdate(latest, ctx);
      } else {
        ctx.ui.notify(`Omni-Pi ${current} is up to date`, "info");
      }
    },
  });
}
