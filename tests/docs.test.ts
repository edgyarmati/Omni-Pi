import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import { getKnownProviderSetups } from "../src/model-setup.js";

describe("documentation coverage", () => {
  test("documents the bundled provider list in sync with known provider setups", () => {
    const providersDoc = readFileSync(
      new URL("../PROVIDERS.md", import.meta.url),
      "utf8",
    );
    const documentedSection = providersDoc
      .split("### Bundled provider list\n\n")[1]
      ?.split("\n## ")[0]
      ?.trim();

    expect(documentedSection).toBeDefined();

    const documentedLines = documentedSection
      ?.split("\n")
      .filter((line) => line.startsWith("- "))
      .map((line) => line.slice(2).trim());

    const expectedLines = getKnownProviderSetups().map((provider) => {
      const authLabel = provider.auth === "oauth" ? "OAuth" : "API key";
      return `\`${provider.id}\` — ${authLabel}`;
    });

    expect(documentedLines).toEqual(expectedLines);
  });

  test("README documents the provider management command split", () => {
    const readme = readFileSync(
      new URL("../README.md", import.meta.url),
      "utf8",
    );

    expect(readme).toContain(
      "| `/model-setup` | Add custom providers/models or remove custom model entries |",
    );
    expect(readme).toContain(
      "| `/manage-providers` | Remove stored auth for bundled providers |",
    );
    expect(readme).toContain(
      "`/model-setup` is for custom providers and custom model entries only.",
    );
    expect(readme).toContain(
      "Use `/manage-providers` to remove stored auth for bundled Pi providers.",
    );
  });
});
