import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { refreshAuthenticatedProviderModels } from "../../src/model-setup.js";
import { registerOmniProviders } from "../../src/providers.js";

export default async function omniProvidersExtension(
  api: ExtensionAPI,
): Promise<void> {
  await registerOmniProviders(api);

  api.on("session_start", async (_event, ctx) => {
    await refreshAuthenticatedProviderModels(ctx.modelRegistry);
  });
}
