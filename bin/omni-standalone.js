#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

async function main() {
  if (!process.versions.bun) {
    const scriptPath = fileURLToPath(import.meta.url);
    const result = spawnSync("bun", [scriptPath, ...process.argv.slice(2)], {
      stdio: "inherit",
    });

    if (result.error) {
      console.error(
        "Standalone mode requires Bun at runtime. Install Bun or run via `npm run chat:standalone`.",
      );
      process.exit(1);
    }

    process.exit(result.status ?? 0);
  }

  const { runStandaloneApp } = await import("../src/standalone/run.ts");
  await runStandaloneApp();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
