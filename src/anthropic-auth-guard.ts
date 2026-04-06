interface AnthropicCredential {
  type: "api_key";
  key: string;
}

interface AuthStorageLike {
  get?(provider: string): AnthropicCredential | { type: "oauth" } | undefined;
  getApiKey?(
    provider: string,
    options?: { includeFallback?: boolean },
  ): Promise<string | undefined>;
  hasAuth?(provider: string): boolean;
  getOAuthProviders?(): Array<{ id: string; name?: string }>;
  login?(providerId: string, callbacks: unknown): Promise<void>;
}

interface ModelRegistryLike {
  authStorage: AuthStorageLike;
  refresh(): void;
  __omniAnthropicAuthGuardInstalled?: boolean;
}

function getAnthropicApiKeyFromStorage(
  authStorage: AuthStorageLike,
): string | undefined {
  const envApiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (envApiKey) {
    return envApiKey;
  }

  const stored = authStorage.get?.("anthropic");
  if (stored?.type === "api_key" && stored.key.trim()) {
    return stored.key.trim();
  }

  return undefined;
}

export function disableAnthropicOAuthInAuthStorage(
  authStorage: AuthStorageLike,
): void {
  const originalGetApiKey = authStorage.getApiKey?.bind(authStorage);
  const originalGetOAuthProviders =
    authStorage.getOAuthProviders?.bind(authStorage);
  authStorage.getApiKey = async (
    provider: string,
    options?: { includeFallback?: boolean },
  ) => {
    if (provider !== "anthropic") {
      return originalGetApiKey?.(provider, options);
    }

    return getAnthropicApiKeyFromStorage(authStorage);
  };

  const originalHasAuth = authStorage.hasAuth?.bind(authStorage);
  authStorage.hasAuth = (provider: string) => {
    if (provider !== "anthropic") {
      return originalHasAuth?.(provider) ?? false;
    }

    return getAnthropicApiKeyFromStorage(authStorage) !== undefined;
  };

  authStorage.getOAuthProviders = () =>
    (originalGetOAuthProviders?.() ?? []).filter(
      (provider) => provider.id !== "anthropic",
    );

  const originalLogin = authStorage.login?.bind(authStorage);
  authStorage.login = async (providerId: string, callbacks: unknown) => {
    if (providerId === "anthropic") {
      throw new Error(
        "Anthropic OAuth login is disabled in Omni-Pi. Use an Anthropic API key instead.",
      );
    }

    await originalLogin?.(providerId, callbacks);
  };
}

export function disableAnthropicOAuth(modelRegistry: ModelRegistryLike): void {
  disableAnthropicOAuthInAuthStorage(modelRegistry.authStorage);

  if (modelRegistry.__omniAnthropicAuthGuardInstalled) {
    return;
  }

  const originalRefresh = modelRegistry.refresh.bind(modelRegistry);
  modelRegistry.refresh = () => {
    originalRefresh();
    disableAnthropicOAuthInAuthStorage(modelRegistry.authStorage);
  };
  modelRegistry.__omniAnthropicAuthGuardInstalled = true;
}
