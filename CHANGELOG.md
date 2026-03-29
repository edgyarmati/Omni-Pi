# Changelog

## 0.6.1 - 2026-03-29

### Provider management

- renamed bundled provider auth management from `/provider-auth` to `/manage-providers`
- limited `/model-setup list` to removing individual custom model entries instead of deleting whole custom providers
- documented the bundled provider list directly in `PROVIDERS.md`

### CI and documentation

- added a unified `npm run verify` gate for local development, CI, and publish checks
- added docs coverage tests so command docs and the bundled provider list fail CI when they drift from the code
- added a tag-triggered release workflow that re-verifies the repo, creates a GitHub release, and publishes to npm when credentials are configured

## 0.6.0 - 2026-03-27

### Provider management

- restricted `/model-setup` to custom providers and custom model entries stored in `models.json`
- added `/provider-auth` to remove stored auth for bundled Pi providers from the UI
- added whole-provider removal for custom providers, not just single-model removal
- fixed `/model-setup list` so it only shows custom providers/models instead of the full authenticated runtime catalog

### Provider discovery and refresh

- added startup refresh for authenticated, discoverable custom providers
- preserved dynamic headers and other existing model metadata when custom providers are edited or rediscovered
- improved custom-provider onboarding so users can add a provider first and discover models automatically
- stopped persisting invalid `contextWindow: 0` and `maxTokens: 0` values for discovered providers

### Selector and UX improvements

- aligned Omni-Pi setup selectors with Pi-style searchable selection behavior
- limited the custom searchable selector to 10 visible rows and only enabled search when more than 10 items are present
- improved bundled command descriptions and provider-management messaging

### Documentation

- documented the split between custom provider setup and bundled provider auth management in `README.md`
- added `PROVIDERS.md` with guidance for `/model-setup`, `/provider-auth`, and custom provider discovery behavior
