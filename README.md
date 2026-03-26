# Omni-Pi

Omni-Pi is a Pi package built around one user-facing brain.

The goal is simple: talk to a helpful agent, let it interview you until the request is precise, have it write the spec and task breakdown into `.omni/`, then implement the work in bounded slices with explicit verification and progress notes.

Requires Node.js 22 or newer.

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/omni-pi.svg)](https://www.npmjs.com/package/omni-pi)
[![CI](https://github.com/EdGy2k/Omni-Pi/actions/workflows/ci.yml/badge.svg)](https://github.com/EdGy2k/Omni-Pi/actions/workflows/ci.yml)

## What It Does

- One friendly brain talks to the user.
- `.omni/` remains the durable memory layer for goals, specs, tasks, checks, progress, and decisions.
- Work is broken into small, verifiable slices before code changes happen.
- Verification is explicit and recorded alongside implementation progress.

## Install

Install the standalone executable:

```bash
npm install -g omni-pi
```

Then run it in any project:

```bash
cd your-project
omni
```

For local development from this checkout:

```bash
git clone https://github.com/EdGy2k/Omni-Pi.git
cd Omni-Pi
npm install
npm run chat
```

## Use

Start Pi in the project you want to work on, with Omni-Pi installed, and describe what you want.

Example:

```text
Build a small CLI notes app for me. I want add, list, and search commands. Store data locally in JSON. Ask me any questions you need before you start coding.
```

Expected behavior:

- Omni-Pi interviews first when the request is underspecified.
- It writes and updates `.omni/PROJECT.md`, `.omni/SPEC.md`, `.omni/TASKS.md`, `.omni/TESTS.md`, and `.omni/STATE.md`.
- It hides internal implementation machinery instead of talking about planner/worker/expert handoffs.
- It implements one bounded slice at a time and runs the planned checks.

## Durable Memory

Omni-Pi keeps its working notes in `.omni/`:

- `PROJECT.md` captures the problem, users, constraints, and success criteria.
- `SPEC.md` captures the exact requested behavior and implementation shape.
- `TASKS.md` breaks work into bounded slices.
- `TESTS.md` records the checks for the current slice.
- `STATE.md`, `SESSION-SUMMARY.md`, and `DECISIONS.md` keep progress and rationale durable across sessions.

## Development

`npm run chat` launches the local `omni` wrapper from this checkout, which in turn starts Pi with this package loaded.

For local verification:

```bash
npm run check
npm run lint
npm test
```

For package verification:

```bash
npm pack
npm publish --dry-run
```

## Attribution

Omni-Pi builds on the Pi ecosystem. See [CREDITS.md](CREDITS.md).

## License

MIT. See [LICENSE](LICENSE).
