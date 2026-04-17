# Refresh custom provider models

## Problem

Omni-Pi can discover models for a custom provider during setup, and it already refreshes authenticated custom providers on startup. However, there is no explicit way to manually re-run discovery later, and the startup refresh happens every session rather than once per day.

This makes it harder to pick up newly released models without redoing setup, and it can cause unnecessary repeated discovery calls on frequent launches.

## Goals

- Add a manual refresh action for discoverable custom providers.
- Keep the existing setup-time discovery flow intact.
- Refresh discoverable custom providers automatically at most once per day, on the first Omni session start that day.
- Reuse the existing model discovery and persistence logic instead of introducing a separate refresh path.

## Non-goals

- Do not change how bundled Pi providers are managed.
- Do not add background polling or repeated refreshes while Omni remains open.
- Do not alter model selection UX beyond exposing refresh entry points.
- Do not attempt to discover providers that were never configured with a base URL and compatible API.

## Proposed behavior

### Manual refresh

Add a `/model-setup refresh` subcommand that re-discovers models for configured custom providers that are eligible for refresh.

The refresh should:

- scan `models.json` for custom providers with a supported API and base URL
- use stored auth, API key settings, or auth storage fallback just like the current refresh path
- update discovered model metadata in `models.json`
- refresh the runtime model registry after writes succeed
- report which providers were refreshed and whether nothing changed

Optionally, the interactive `/model-setup` menu can include the same refresh action as a discoverable choice so the feature remains easy to find.

### Setup-time discovery

Keep the existing behavior where entering a custom provider’s API endpoint and key can immediately discover models during setup.

No new UI is needed here unless the implementation naturally reuses the refresh helper to reduce duplicated logic.

### Daily startup refresh

On session start, Omni should check whether a refresh has already run today.

If not, it should:

- refresh eligible discoverable custom providers
- write any updates back to `models.json`
- refresh the model registry
- record the last successful refresh date in a small durable runtime-local state file

If a refresh already ran today, Omni should skip the work.

If the refresh fails for a provider, Omni should continue checking the rest of the eligible providers and only skip the refresh date update if nothing succeeded.

## Architecture

### 1. Shared refresh service

Keep a single refresh helper in `src/model-setup.ts` as the canonical implementation for discovery, merge behavior, persistence, and registry refresh.

That helper should remain responsible for:

- loading and updating `models.json`
- resolving the correct auth source for a provider
- calling provider discovery
- preserving existing model metadata when discovery returns updates
- writing the updated config back to disk

### 2. Manual command entry point

Extend `src/model-command.ts` with a refresh subcommand.

The command layer should stay thin:

- parse the subcommand
- call the refresh helper
- show a user-facing notification

### 3. Daily refresh guard

Add a small state file under Pi runtime-local state, not durable project memory, to store the last refresh date.

The session-start hook should:

- read the state
- compare it to the current date in the local timezone or a clearly defined ISO date
- run the refresh only when the date has changed
- update the state only when the refresh work actually succeeds for at least one provider

### 4. Existing setup flow reuse

The provider setup wizard should continue to use the same discovery rules.

Where possible, the setup flow should reuse the shared refresh/discovery helper or the same internal update builder, so the setup path and refresh path do not drift apart.

## Error handling

- If a provider cannot be refreshed, omit it from the success list and continue with the rest.
- If a refresh finds no models, keep the existing provider configuration unchanged.
- If manual refresh is invoked and nothing is eligible, show a clear informational message.
- If the daily refresh state cannot be read, treat it as "not refreshed today" and proceed.
- If writing the refresh timestamp fails after a successful refresh, treat that as a recoverable error and still keep the model updates.

## UX notes

Recommended user-facing commands/options:

- `/model-setup add` — existing setup path
- `/model-setup refresh` — new refresh path
- `/model-setup list` — existing removal/list path

If the interactive menu is updated, the option labels should make it clear that refresh re-discovers models from already configured custom providers.

Example menu entries:

- add — Add a custom provider or model
- refresh — Re-discover models for configured custom providers
- list — Show custom models / remove model entries

## Testing

Add or update tests to cover:

- manual refresh command dispatches to the shared refresh logic
- refresh only targets eligible configured custom providers
- successful refresh updates `models.json` and refreshes the registry
- daily refresh runs once per day and skips repeated session starts on the same date
- failed refresh on one provider does not block others
- setup-time discovery still behaves the same after the refactor

## Acceptance criteria

- Users can manually refresh custom provider models without re-entering setup.
- Omni refreshes discoverable authenticated custom providers at most once per day on startup.
- Setup-time discovery still works as before.
- Existing model metadata preservation rules remain intact.
- Tests cover both the manual and daily refresh paths.
