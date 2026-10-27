---
description: "Local external LLM CLI adapter for DeepSeek Harness supporting Agy, Codex, Claude Code, and Copilot CLIs without API keys."
kind: "package-reference"
---

# @deepseek-ai/dsh-llm-external-cli

## Summary

`@deepseek-ai/dsh-llm-external-cli` routes DeepSeek Harness model requests to local external LLM CLIs such as Agy, Codex, Claude Code, and Copilot via standard input and standard output. It executes commands locally without requiring a DeepSeek API key or external HTTP credentials. Formatted prompts are passed to child process stdin, and captured stdout is normalized into the canonical DeepSeek Harness streaming and completion chunk protocol with reasoning separation and token usage accounting.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin when you want DeepSeek Harness to dispatch prompts to a locally installed LLM command-line interface instead of calling a remote HTTP API.

### When to choose it

Choose this provider when working offline, utilizing subscription-authenticated local CLIs, or running local AI agents (Google Antigravity `agy`, OpenAI `codex`, Anthropic `claude`, GitHub `copilot`) without configuring a DeepSeek API key or HTTP endpoint.

### CLI Examples

#### 1. Google Antigravity CLI (Agy)

Configure the `agy` CLI as your backend provider:

```yaml
- id: llm-external-cli
  name: '@deepseek-ai/dsh-llm-external-cli'
  config:
    command: agy
    args: []
```

Run via the CLI dispatcher:

```bash
pnpm dsh headless --provider external-cli --model agy "Explain quicksort algorithm"
```

#### 2. OpenAI Codex CLI

Configure the `codex` CLI with execution arguments:

```yaml
- id: llm-external-cli
  name: '@deepseek-ai/dsh-llm-external-cli'
  config:
    command: codex
    args: ['exec']
```

Run via the CLI dispatcher:

```bash
pnpm dsh headless --provider external-cli --model codex "Refactor utils.ts to use modern syntax"
```

#### 3. Anthropic Claude Code CLI

Configure the `claude` CLI with non-interactive print mode:

```yaml
- id: llm-external-cli
  name: '@deepseek-ai/dsh-llm-external-cli'
  config:
    command: claude
    args: ['--print']
```

Run via the CLI dispatcher:

```bash
pnpm dsh headless --provider external-cli --model claude "Find and fix bugs in tests"
```

#### 4. GitHub Copilot CLI

Configure the GitHub `copilot` CLI:

```yaml
- id: llm-external-cli
  name: '@deepseek-ai/dsh-llm-external-cli'
  config:
    command: copilot
    args: ['suggest']
```

Run via the CLI dispatcher:

```bash
pnpm dsh headless --provider external-cli --model copilot "Generate a docker compose file for PostgreSQL"
```

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`ExternalCliAdapter` implements `LlmAdapter` from `@deepseek-ai/dsh-llm`. For each turn, it formats prompt messages into text, spawns the specified command, writes to child stdin, and reads stdout. Standard output containing `<think>...</think>` tags is parsed to separate reasoning deltas from visible text deltas. All API key validation is completely bypassed for this provider.

-----

<a id="further-exploration"></a>
## Further Exploration

- [dsh-llm service](../llm/README.md) - the provider-neutral LLM service this adapter registers on.
- [llm-deepseek adapter](../llm-deepseek/README.md) - direct HTTP API adapter for DeepSeek.
- [llm-pi-ai adapter](../llm-pi-ai/README.md) - multi-provider API adapter.

-----

<a id="model-experience"></a>
## Model Experience

### External CLI execution

#### What the model sees

The external CLI process receives serialized system prompts and conversation turn messages over stdin. Single-turn completion prompts are sent as raw text; multi-turn conversations include role headers (`[System]`, `[User]`, `[Assistant]`, `[Tool Result]`).

#### Token effect

Token usage is estimated from prompt character counts and CLI output character lengths, normalized into `TokenUsage` accounting chunks.

#### KV Cache effect

Prompt prefix reuse and caching behavior depend entirely on the external local CLI's internal caching implementation.

-----

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- Interactive multi-step tool calls require native CLI support in the targeted external tool.
