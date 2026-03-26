# Contributing to Omni-Pi

Thanks for your interest in contributing.

## Getting Started

1. Fork the repository on GitHub.
2. Clone your fork locally:

   ```bash
   git clone https://github.com/<your-username>/Omni-Pi.git
   cd Omni-Pi
   npm install
   ```

3. Run the launcher locally:

   ```bash
   node ./bin/omni.js
   ```

## Development Commands

| Command | Purpose |
|---------|---------|
| `npm test` | Run the test suite with Vitest |
| `npm run check` | Run the TypeScript type-check |
| `npm run lint` | Run Biome lint and format checks |
| `npm run format` | Auto-fix lint and formatting issues |

## Code Standards

- Use ES modules only. `import.meta.url` is the preferred path pattern, and CommonJS is not used in `src/` or `extensions/`.
- Keep TypeScript strict. `npm run check` must pass before submitting changes.
- Keep Biome clean. Run `npm run lint` and `npm run format` when needed.
- Prefer small, focused files and avoid unnecessary mutation.

## Testing

- Tests live in `tests/` and use Vitest.
- Run `npm test` before opening a pull request.
- Add tests for new behavior when practical.

## Commit Messages

Use conventional commit formatting:

```text
<type>: <description>
```

Common types include `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, and `ci`.

Examples:

- `feat: add parallel task execution`
- `fix: resolve config parsing double-escape`
- `docs: update install instructions`

## Pull Request Process

1. Create a feature branch from `main`.
2. Make your changes.
3. Ensure the checks pass:

   ```bash
   npm test && npm run check && npm run lint
   ```

4. Open a pull request with a clear description of what changed and why.
5. Link any related issues.

## Installing from Source

To install the branded `omni` command globally from a local checkout:

```bash
npm install -g .
omni
```

To test the packaged tarball flow:

```bash
npm pack
npm install -g ./omni-pi-0.1.0.tgz
omni
```

## Questions

If something is unclear, open an issue on [GitHub](https://github.com/EdGy2k/Omni-Pi/issues).
