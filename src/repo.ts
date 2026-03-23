import { access, readFile } from "node:fs/promises";
import path from "node:path";

export interface RepoSignals {
  languages: string[];
  frameworks: string[];
  tools: string[];
  files: string[];
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readPackageJson(rootDir: string): Promise<Record<string, unknown> | null> {
  const packageJsonPath = path.join(rootDir, "package.json");
  if (!(await exists(packageJsonPath))) {
    return null;
  }

  try {
    return JSON.parse(await readFile(packageJsonPath, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function gatherPackageNames(pkg: Record<string, unknown> | null): string[] {
  if (!pkg) {
    return [];
  }

  const sections = ["dependencies", "devDependencies", "peerDependencies"];
  const names = new Set<string>();

  for (const section of sections) {
    const value = pkg[section];
    if (value && typeof value === "object") {
      for (const key of Object.keys(value as Record<string, unknown>)) {
        names.add(key);
      }
    }
  }

  return [...names];
}

export async function detectRepoSignals(rootDir: string): Promise<RepoSignals> {
  const filesToCheck = [
    "package.json",
    "Cargo.toml",
    "playwright.config.ts",
    "playwright.config.js",
    "cypress.config.ts",
    "cypress.config.js",
    "vite.config.ts",
    "next.config.js",
    "next.config.mjs",
    "tsconfig.json"
  ];

  const presentFiles = (
    await Promise.all(
      filesToCheck.map(async (file) => ((await exists(path.join(rootDir, file))) ? file : null))
    )
  ).filter((value): value is string => value !== null);

  const packageJson = await readPackageJson(rootDir);
  const packageNames = gatherPackageNames(packageJson);

  const languages = new Set<string>();
  const frameworks = new Set<string>();
  const tools = new Set<string>();

  if (presentFiles.includes("Cargo.toml")) {
    languages.add("rust");
  }

  if (presentFiles.includes("tsconfig.json") || packageNames.some((name) => name.includes("typescript"))) {
    languages.add("typescript");
  }

  if (packageNames.includes("react") || packageNames.includes("next")) {
    frameworks.add("react");
  }

  if (packageNames.includes("next") || presentFiles.some((file) => file.startsWith("next.config"))) {
    frameworks.add("nextjs");
  }

  if (packageNames.includes("vite") || presentFiles.includes("vite.config.ts")) {
    tools.add("vite");
  }

  if (presentFiles.some((file) => file.startsWith("playwright.config"))) {
    tools.add("playwright");
  }

  if (presentFiles.some((file) => file.startsWith("cypress.config"))) {
    tools.add("cypress");
  }

  if (packageNames.includes("vitest")) {
    tools.add("vitest");
  }

  if (packageNames.includes("jest")) {
    tools.add("jest");
  }

  return {
    languages: [...languages].sort(),
    frameworks: [...frameworks].sort(),
    tools: [...tools].sort(),
    files: presentFiles.sort()
  };
}
