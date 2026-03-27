import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@mariozechner/pi-coding-agent";

import { getKnownProviderSetups } from "./model-setup.js";
import { searchableSelect } from "./searchable-select.js";

interface AuthCredential {
  type: "api_key" | "oauth";
}

interface AuthStorageLike {
  get(provider: string): AuthCredential | undefined;
  list(): string[];
  remove(provider: string): void;
  logout?(provider: string): void;
}

interface KnownProviderAuthOption {
  provider: string;
  label: string;
  authType: "API key" | "OAuth";
}

export function buildKnownProviderAuthOptions(
  providers: string[],
  getCredential: (provider: string) => AuthCredential | undefined,
): KnownProviderAuthOption[] {
  const knownProviders = new Map(
    getKnownProviderSetups().map((provider) => [provider.id, provider]),
  );

  return providers
    .filter((provider) => knownProviders.has(provider))
    .map((provider) => {
      const known = knownProviders.get(provider);
      const credential = getCredential(provider);
      const authType: KnownProviderAuthOption["authType"] =
        credential?.type === "oauth" ? "OAuth" : "API key";

      return {
        provider,
        label: `${known?.label ?? provider} [${provider}]  ${authType}`,
        authType,
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label));
}

async function handleList(ctx: ExtensionCommandContext): Promise<void> {
  const authStorage = ctx.modelRegistry.authStorage as AuthStorageLike;
  const options = buildKnownProviderAuthOptions(
    authStorage.list(),
    (provider) => authStorage.get(provider),
  );

  if (options.length === 0) {
    ctx.ui.notify("No bundled providers have stored auth.", "info");
    return;
  }

  const selected = await searchableSelect(
    ctx.ui,
    "Bundled provider auth (select one to remove):",
    options.map((option) => ({
      label: option.label,
      value: option.provider,
      searchText: `${option.provider} ${option.label} ${option.authType}`,
    })),
  );
  if (!selected) return;

  const option = options.find((entry) => entry.provider === selected);
  if (!option) return;

  const confirmed = await ctx.ui.confirm(
    "Remove provider auth?",
    `Remove stored ${option.authType} credentials for ${selected}?`,
  );
  if (!confirmed) return;

  const credential = authStorage.get(selected);
  if (
    credential?.type === "oauth" &&
    typeof authStorage.logout === "function"
  ) {
    authStorage.logout(selected);
  } else {
    authStorage.remove(selected);
  }

  ctx.modelRegistry.refresh();
  ctx.ui.notify(`Removed stored auth for ${selected}.`, "info");
}

export function registerProviderAuthCommand(api: ExtensionAPI): void {
  api.registerCommand("provider-auth", {
    description: "List or remove stored auth for bundled providers",
    async handler(_args: string, ctx: ExtensionCommandContext) {
      await handleList(ctx);
    },
  });
}
