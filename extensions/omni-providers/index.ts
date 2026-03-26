import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { registerOmniProviders } from "../../src/providers.js";

export default async function omniProvidersExtension(
  api: ExtensionAPI,
): Promise<void> {
  await registerOmniProviders(api);
}
