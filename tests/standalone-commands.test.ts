import { describe, expect, test } from "vitest";

import { filterStandaloneSlashCommands } from "../src/standalone/commands.js";

describe("standalone slash command filtering", () => {
  test("matches fuzzy shorthand across token boundaries", () => {
    const matches = filterStandaloneSlashCommands("/rtk");
    expect(matches[0]?.name).toBe("omni-rtk");
  });

  test("keeps strong prefix matches ahead of fuzzier matches", () => {
    const matches = filterStandaloneSlashCommands("/mo");
    expect(matches.slice(0, 2).map((entry) => entry.name)).toEqual([
      "model",
      "model-setup",
    ]);
  });

  test("matches non-prefix subsequences like provider shorthand", () => {
    const matches = filterStandaloneSlashCommands("/mpr");
    expect(matches.some((entry) => entry.name === "manage-providers")).toBe(true);
  });

  test("returns no matches when the query characters do not appear in order", () => {
    expect(filterStandaloneSlashCommands("/zqv")).toEqual([]);
  });

  test("matches alias commands from vendor-style slash metadata", () => {
    const matches = filterStandaloneSlashCommands("/exit");
    expect(matches[0]?.name).toBe("quit");
  });
});
