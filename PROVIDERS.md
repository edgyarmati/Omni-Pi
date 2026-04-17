# Provider Setup

Omni-Pi separates bundled providers from custom providers.

## `/model-setup`

`/model-setup` is only for custom providers and custom model entries stored in `models.json`.

Use it when you want to configure:

- your own provider id
- an API type such as OpenAI-compatible or Anthropic-compatible
- a custom base URL
- an API key for that custom provider
- discovered models or manual model entries

`/model-setup list` only shows custom models from `models.json`, and it removes individual custom model entries only.

## Bundled Providers

Pi's bundled providers are still available through the runtime model registry, but Omni-Pi does not manage them through `/model-setup`.

That means:

- `/model-setup` does not add bundled providers
- `/model-setup` does not list bundled providers
- `/model-setup` does not remove bundled providers

If a bundled provider already has valid auth in the Pi runtime, Omni-Pi may use it through normal model selection, but its setup is outside the custom-provider flow documented here.

Use `/manage-providers` to list bundled providers that currently have stored auth and remove that auth when needed.

Anthropic is API-key-only in Omni-Pi. Anthropic OAuth login is intentionally disabled.

The bundled-provider list below is expected to stay in sync with the exported provider setup list in `src/model-setup.ts`. The test suite checks that this section matches the code list.

### Bundled provider list

- `anthropic` — API key
- `openai` — API key
- `openrouter` — API key
- `google` — API key
- `github-copilot` — OAuth
- `openai-codex` — OAuth
- `xai` — API key
- `zai` — API key
- `azure-openai-responses` — API key
- `nvidia` — API key
- `together` — API key
- `synthetic` — API key
- `nanogpt` — API key
- `xiaomi` — API key
- `moonshot` — API key
- `venice` — API key
- `kilo` — API key
- `gitlab-duo` — API key
- `qwen-portal` — API key
- `qianfan` — API key
- `cloudflare-ai-gateway` — API key

## Custom Provider Discovery

For custom providers that expose a compatible model listing endpoint, Omni-Pi can fetch models for you after you add the provider details and credentials.

On launch, Omni-Pi refreshes authenticated, discoverable custom providers that are already configured in `models.json` at most once per day.

You can also run `/model-setup refresh` to re-discover those custom provider models on demand.

## When To Use Which Path

Use `/model-setup` when:

- you are adding a non-bundled provider
- you need a custom base URL
- you want to manage your own discovered or manual model list

Do not use `/model-setup` when:

- you are trying to manage a built-in Pi provider
- you expect bundled providers to appear as removable custom entries
