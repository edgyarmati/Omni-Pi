import { describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  wizard: vi.fn(),
}));

vi.mock("../src/model-setup.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/model-setup.js")>();
  return {
    ...actual,
    refreshAuthenticatedProviderModelsWithDailyGuard: mocks.refresh,
    runModelSetupWizard: mocks.wizard,
  };
});

import { registerModelCommand } from "../src/model-command.js";

describe("model command", () => {
  test("dispatches refresh subcommand to the shared refresh helper", async () => {
    const handlers = new Map<string, (args: string, ctx: never) => Promise<void>>();
    registerModelCommand({
      registerCommand(name: string, command: { handler: (args: string, ctx: never) => Promise<void> }) {
        handlers.set(name, command.handler);
      },
    } as never);

    const notify = vi.fn();
    mocks.refresh.mockResolvedValue({ refreshedProviders: ["custom-openai"], skipped: false });

    await handlers.get("model-setup")?.("refresh", {
      modelRegistry: {} as never,
      ui: {
        notify,
      },
    } as never);

    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).toHaveBeenCalledWith({}, { force: true });
    expect(notify).toHaveBeenCalledWith(
      "Refreshed custom providers: custom-openai.",
      "info",
    );
  });
});
