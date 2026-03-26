import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { registerOmniMessageRenderer } from "../../src/pi.js";

export default function omniCoreExtension(api: ExtensionAPI): void {
  registerOmniMessageRenderer(api);
}
