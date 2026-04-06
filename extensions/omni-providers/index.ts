import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { disableAnthropicOAuth } from "../../src/anthropic-auth-guard.js";
import { refreshAuthenticatedProviderModels } from "../../src/model-setup.js";
import { registerOmniProviders } from "../../src/providers.js";

export default async function omniProvidersExtension(
  api: ExtensionAPI,
): Promise<void> {
  await registerOmniProviders(api);

  api.on("session_start", async (_event, ctx) => {
    disableAnthropicOAuth(ctx.modelRegistry);
    await refreshAuthenticatedProviderModels(ctx.modelRegistry);
  });
}
