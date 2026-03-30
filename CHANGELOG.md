# Changelog

## 0.6.2 - 2026-03-30

### Native micro-UI

- bundled `glimpseui` as a first-class Omni-Pi dependency
- loaded the packaged Glimpse Pi extension and `glimpse` skill so native dialogs, forms, previews, and overlays are available to the agent
- added support for the `/companion` command to toggle the optional floating Glimpse status widget

### Documentation

- documented the bundled Glimpse integration in `README.md`
- clarified that Glimpse UI support is available even when the floating companion is disabled

## 0.6.1 - 2026-03-29

### Provider management

- renamed bundled provider auth management from `/provider-auth` to `/manage-providers`
- narrowed `/model-setup` so its list flow removes only custom model entries, not whole custom providers
- updated command labels and docs to reflect the split between custom model setup and bundled provider auth management

### Documentation and validation

- added the bundled provider list to `PROVIDERS.md`
- added documentation coverage tests for the bundled provider list and the README command contract
- made docs drift fail the test suite when the code-backed provider list or command docs change without matching documentation

### CI/CD

- added a unified `npm run verify` gate for local development, CI, and prepublish checks
- updated CI to run the shared verify gate instead of separate ad hoc steps
- added a tag-triggered release workflow that re-verifies the repo, creates a GitHub release, and publishes to npm when workflow credentials are configured

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
