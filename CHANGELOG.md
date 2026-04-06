# Changelog

## 0.8.0 - 2026-04-06

### Omni mode

- changed Omni-Pi to start in standard Pi behavior by default while keeping Omni branding and shell UI
- added persistent `/omni-mode` to toggle the specialized Omni workflow per project
- made Omni mode initialize or migrate `.omni/` lazily on the first real turn instead of at session start
- fixed the first-turn Omni onboarding race so the kickoff instructions are folded into the active prompt instead of trying to enqueue a second user message mid-turn

### Durable standards and memory

- split passive `.omni/` standards from active workflow state so normal mode can still follow durable project guidance without resuming task execution
- added `.omni/VERSION` and migration handling for the Omni durable-memory standard
- added external standards discovery/import for files such as `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, Copilot instructions, Cursor rules, Windsurf rules, and Continue rules
- automatically add `.pi/` to `.gitignore` during Omni init or migration when the workspace is a Git repository

### Skills

- bundled `find-skills`, `skill-creator`, and `brainstorming` directly with the npm package as built-in default skills
- made Omni automatically check task skill requirements, install matching skills project-scope, create a project-specific skill when no match exists, and remove unused project skills when no open task still depends on them
- persisted task skill dependencies in `.omni/TASKS.md` so planning, dispatch, and execution share the same skill graph
- removed the mistaken default Rust-specific recommendations so task-driven skill discovery is now the primary path

### Documentation

- updated `README.md` and `AGENTS.md` to document opt-in Omni mode, bundled skills, standards import, and automatic task skill management

## 0.7.1 - 2026-04-05

### Dependencies

- upgraded `@mariozechner/pi-coding-agent` to `0.65.0`
- removed `session_switch` handler from omni-memory extension (event removed upstream; `session_start` now covers session switches via `event.reason`)

## 0.7.0 - 2026-03-30

### Interview-first workflow

- require the interview tool for ambiguous requests instead of ad hoc chat clarification
- treat direct instructions in this repo as Omni app/product behavior changes by default unless explicitly marked as meta
- add first-run onboarding for ambiguous projects so Omni captures goal, users, constraints, workflow preferences, and missing context before planning or implementation

### Planning continuity

- reset stale active tasks when a new request is unrelated to the previous work
- archive concise summaries of replaced task lists outside `.omni/TASKS.md` while keeping related follow-up work continuous

## 0.6.4 - 2026-03-30

### Publishing and release automation

- normalized the package repository URL to the canonical GitHub repository form used by npm trusted publishing
- updated GitHub Actions workflows to the current Node 24 action/toolchain path
- replaced the JavaScript GitHub release action with the GitHub CLI so the release workflow no longer depends on deprecated Node 20 action runtimes

### Runtime and UX

- upgraded `@mariozechner/pi-coding-agent` to `0.64.0`
- suppressed the redundant success toast after a successful self-update install while still prompting for restart

## 0.6.3 - 2026-03-30

### Runtime and UX

- upgraded `@mariozechner/pi-coding-agent` to `0.64.0`
- suppressed the redundant success toast after a successful self-update install while still prompting for restart

### Release workflow

- moved npm publishing ahead of GitHub release creation so failed npm publishes do not leave behind a misleading GitHub release
- kept trusted publishing with provenance as the release path for tagged builds

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
