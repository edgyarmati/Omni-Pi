# Omni-Pi

Omni-Pi: Guided software delivery for everyone.

Omni-Pi is an opinionated Pi package and branded launcher published on npm as `omni-pi`. It helps people move from a blank repo to a structured plan, implemented work, and explicit verification without having to assemble the workflow themselves.

Requires Node.js 22 or newer.

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/omni-pi.svg)](https://www.npmjs.com/package/omni-pi)
[![CI](https://github.com/EdGy2k/Omni-Pi/actions/workflows/ci.yml/badge.svg)](https://github.com/EdGy2k/Omni-Pi/actions/workflows/ci.yml)

## Why Omni-Pi

- Guided step-by-step workflow keeps the process moving without blank-canvas paralysis.
- Durable project memory in `.omni/` survives across sessions.
- Automatic verification infers checks from the language and project shape.
- Expert fallback takes over when the worker agent gets stuck.

## Quick Start

Install Omni-Pi from npm, then run it in your project:

```bash
npm install -g omni-pi
cd your-project
omni
```

## Install

Install the published package globally with npm:

```bash
npm install -g omni-pi
```

Confirm the launcher is available:

```bash
omni --help
```

Then open any project directory and start Omni-Pi:

```bash
cd your-project
omni
```

To upgrade later:

```bash
npm install -g omni-pi@latest
```

Omni-Pi launches the bundled Pi runtime and loads the Omni-Pi package automatically, so you do not need to manually wire extensions, skills, or prompts after installing from npm.

## Model Providers

Omni-Pi now ships the upstream provider mix needed for practical multi-provider use on top of Pi.

- Built into the underlying Pi runtime: `anthropic`, `openai`, `openai-codex`, `google`, `google-vertex`, `amazon-bedrock`, `azure-openai-responses`, `openrouter`, `xai`, `zai`, `mistral`, `groq`, `cerebras`, `huggingface`, `github-copilot`, `kimi-coding`, `minimax`, `minimax-cn`, `opencode`, `opencode-go`
- Added by Omni-Pi: `nvidia`, `together`, `synthetic`, `nanogpt`, `xiaomi`, `moonshot`, `venice`, `kilo`, `gitlab-duo`, `qwen-portal`, `qianfan`, `cloudflare-ai-gateway`
- Auto-discovered when running locally: `ollama`, `lm-studio`, `llama.cpp`, `litellm`, `vllm`

For users who do not want to rely on Anthropic OAuth inside Pi, Omni-Pi also exposes opt-in Claude Agent SDK model aliases:

- `claude-agent/claude-sonnet-4-6`
- `claude-agent/claude-opus-4-6`

These are intended for Omni-Pi's worker and expert subagents. Configure a role with `/omni-model` and Omni-Pi will run that subagent through the Claude Agent SDK instead of Pi's normal Anthropic provider path.

Common provider env vars:

- `NVIDIA_API_KEY`, `TOGETHER_API_KEY`, `SYNTHETIC_API_KEY`, `NANO_GPT_API_KEY`
- `XIAOMI_API_KEY`, `MOONSHOT_API_KEY`, `VENICE_API_KEY`, `KILO_API_KEY`
- `GITLAB_TOKEN`, `QWEN_OAUTH_TOKEN` or `QWEN_PORTAL_API_KEY`, `QIANFAN_API_KEY`
- `CLOUDFLARE_AI_GATEWAY_API_KEY` and `CLOUDFLARE_AI_GATEWAY_BASE_URL`

Omni-Pi ships bundled fallback model metadata for its added providers and also attempts live model discovery against provider endpoints when available.

Provider base URL override env vars:

- `NVIDIA_BASE_URL`, `TOGETHER_BASE_URL`, `SYNTHETIC_BASE_URL`, `NANO_GPT_BASE_URL`
- `MOONSHOT_BASE_URL`, `VENICE_BASE_URL`, `KILO_BASE_URL`
- `QWEN_PORTAL_BASE_URL`, `QIANFAN_BASE_URL`
- `XIAOMI_BASE_URL`, `GITLAB_DUO_BASE_URL`, `CLOUDFLARE_AI_GATEWAY_BASE_URL`

`xiaomi` and `gitlab-duo` are only registered when their base URL is configured explicitly.

For local providers, Omni-Pi registers models only when the endpoint is reachable:

- `OLLAMA_BASE_URL` / `OLLAMA_API_KEY`
- `LM_STUDIO_BASE_URL` / `LM_STUDIO_API_KEY`
- `LLAMA_CPP_BASE_URL` / `LLAMA_CPP_API_KEY`
- `LITELLM_BASE_URL` / `LITELLM_API_KEY`
- `VLLM_BASE_URL` / `VLLM_API_KEY`

## Commands

| Command | Description |
|---------|-------------|
| `/omni-init` | Initialize `.omni/` project memory, run quick-start wizard, scan repo signals, run health checks (`--quick` to skip wizard) |
| `/omni-plan` | Create or refresh spec, tasks, and tests (supports `--preset bugfix/feature/refactor/spike/security-audit`) |
| `/omni-work` | Run the next task through worker, verifier, and expert fallback |
| `/omni-status` | Show current phase, task, blockers, next step (add `metrics` for agent stats) |
| `/omni-sync` | Update durable memory files from recent progress |
| `/omni-skills` | Inspect installed, recommended, deferred, and rejected skills |
| `/omni-explain` | Explain what Omni-Pi is doing in simple language |
| `/omni-model` | Interactively select the model for a specific agent role, or enter any canonical `provider/model` reference |
| `/omni-commit` | Create a branch and commit for the last completed task |
| `/omni-doctor` | Run diagnostic health checks and detect stuck tasks |

## How It Works

Omni-Pi follows a simple agent pipeline: Brain, Planner, Worker, Expert. The Brain handles conversation, the Planner turns intent into concrete steps and checks, and the Worker executes bounded tasks with filesystem-backed state in `.omni/`.

When the Worker gets stuck or verification fails repeatedly, the Expert role steps in to recover the task, adapt the approach, or surface the blocker clearly instead of letting the session stall.

On first use inside a project, Omni-Pi creates and updates `.omni/` state so plans, task progress, verification steps, and recovery context persist across sessions.

## Features

- Core workflow with durable `.omni/` project memory, typed planning and execution contracts, filesystem-backed init/planning/status, and retry-aware task execution.
- Language-aware verification that infers test commands for common stacks and supports custom checks in `.omni/TESTS.md`.
- Workflow presets for bugfix, feature, refactor, spike, and security-audit work.
- Doctor checks for init state, config validity, repo signals, task health, and stuck detection.
- Plan and progress memory with dated plan files, an index tracker, and timestamped progress logs.
- Context-aware file selection for different workflow phases.
- Subagent integration for worker and expert execution with raw output persistence and model overrides.
- Persistent dashboard state for phase, task, blockers, next step, and health status.
- Git integration for branch creation and task-derived commits.
- Interactive planning for constraints, user context, and skill install tracking.

## Development

For local checkout development, see [CONTRIBUTING.md](CONTRIBUTING.md).

```bash
git clone https://github.com/EdGy2k/Omni-Pi.git
cd Omni-Pi
npm install
npm test
npm run check
npm run lint
```

## Attribution

Omni-Pi builds on the Pi ecosystem. See [CREDITS.md](CREDITS.md) for full attribution.

## License

MIT. See [LICENSE](LICENSE).
