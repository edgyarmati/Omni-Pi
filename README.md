# Omni-Pi

Omni-Pi is a Pi package built around one user-facing brain.

The goal is simple: talk to a helpful agent, let it interview you until the request is precise, have it write the spec and task breakdown into `.omni/`, then implement the work in bounded slices with explicit verification and progress notes.

Requires Node.js 22 or newer.

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/omni-pi.svg)](https://www.npmjs.com/package/omni-pi)
[![CI](https://github.com/EdGy2k/Omni-Pi/actions/workflows/ci.yml/badge.svg)](https://github.com/EdGy2k/Omni-Pi/actions/workflows/ci.yml)

## Current Direction

- One friendly brain talks to the user.
- `.omni/` remains the durable memory layer for goals, specs, tasks, checks, progress, and decisions.
- Work is still broken into small, verifiable slices before code changes happen.
- Verification remains explicit and should be recorded alongside implementation progress.

## Durable Memory

Omni-Pi keeps its working notes in `.omni/`:

- `PROJECT.md` captures the problem, users, constraints, and success criteria.
- `SPEC.md` captures the exact requested behavior and implementation shape.
- `TASKS.md` breaks work into bounded slices.
- `TESTS.md` records the checks for the current slice.
- `STATE.md`, `SESSION-SUMMARY.md`, and `DECISIONS.md` keep progress and rationale durable across sessions.

## Development

```bash
git clone https://github.com/EdGy2k/Omni-Pi.git
cd Omni-Pi
npm install
npm run chat
```

`npm run chat` launches Pi with this package loaded, so you can test the real single-brain behavior in an interactive session.

For local verification:

```bash
npm test
npm run check
npm run lint
```

## Attribution

Omni-Pi builds on the Pi ecosystem. See [CREDITS.md](CREDITS.md).

## License

MIT. See [LICENSE](LICENSE).
