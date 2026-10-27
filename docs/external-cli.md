# External Local LLM CLI Provider (`external-cli`)

DeepSeek Harness supports using external local LLM command-line tools as backend model providers without requiring a DeepSeek API key or external HTTP credentials.

## Overview

The `external-cli` provider executes a local CLI binary on your machine, streams the formatted prompt to the process via standard input (`stdin`), and captures standard output (`stdout`) as the model response.

Key characteristics:
- **Zero API Key Requirement**: Skips all DeepSeek and cloud API key validation logic.
- **Local Process Execution**: Invokes local binaries (such as `agy`, `codex`, `claude`, `copilot`).
- **Normalized Response Protocol**: Converts CLI stdout into DeepSeek Harness canonical `StreamChunk` format (text blocks, reasoning `<think>` blocks, token usage, and finish reasons).
- **Dual Mode Compatibility**: Compatible with both single-turn completion mode (raw text prompt) and multi-turn chat mode (structured turn headers).

## Configuration Reference

The provider is provided by `@deepseek-ai/dsh-llm-external-cli` and configured in your profile `cordis.patch.yml` or an overlay:

```yaml
- id: llm-external-cli
  name: '@deepseek-ai/dsh-llm-external-cli'
  config:
    command: claude          # The executable name or path
    args:                    # Optional array of additional CLI flags
      - '--print'
    timeoutMs: 120000        # Command execution timeout in milliseconds (default: 120000)
    shell: true              # Execute through system shell (default: true on Windows)
    provider: external-cli   # Route key (default: external-cli)
```

## CLI Examples

### 1. Google Antigravity CLI (`agy`)

Use your local Google Antigravity CLI installation as the model backend:

```yaml
- id: agent-default-model
  config:
    provider: external-cli
    model: agy

- id: llm-external-cli
  name: '@deepseek-ai/dsh-llm-external-cli'
  config:
    command: agy
    args: []
```

Run directly from the CLI:

```bash
pnpm dsh headless --provider external-cli --model agy "Explain the actor model in concurrent programming"
```

### 2. OpenAI Codex CLI (`codex`)

Use the OpenAI Codex CLI in non-interactive execution mode:

```yaml
- id: agent-default-model
  config:
    provider: external-cli
    model: codex

- id: llm-external-cli
  name: '@deepseek-ai/dsh-llm-external-cli'
  config:
    command: codex
    args:
      - 'exec'
```

Run directly from the CLI:

```bash
pnpm dsh headless --provider external-cli --model codex "Write a TypeScript function to debounce an async call"
```

### 3. Anthropic Claude Code CLI (`claude`)

Use the Anthropic Claude Code CLI with print mode:

```yaml
- id: agent-default-model
  config:
    provider: external-cli
    model: claude

- id: llm-external-cli
  name: '@deepseek-ai/dsh-llm-external-cli'
  config:
    command: claude
    args:
      - '--print'
```

Run directly from the CLI:

```bash
pnpm dsh headless --provider external-cli --model claude "Review packages/core for memory leaks"
```

### 4. GitHub Copilot CLI (`copilot`)

Use the GitHub Copilot CLI:

```yaml
- id: agent-default-model
  config:
    provider: external-cli
    model: copilot

- id: llm-external-cli
  name: '@deepseek-ai/dsh-llm-external-cli'
  config:
    command: copilot
    args:
      - 'suggest'
```

Run directly from the CLI:

```bash
pnpm dsh headless --provider external-cli --model copilot "Generate a systemd service unit for a node app"
```

## How It Works

1. **Prompt Serialization**:
   - In completion mode with a single user message containing plain text, the raw text is written directly to the child process stdin.
   - In multi-turn chat mode, messages are formatted with structured role headers (`[System]`, `[User]`, `[Assistant]`, `[Tool Result]`) followed by `[Assistant]` to signal the model's turn.
2. **Process Invocation**:
   - The child process is spawned with piped stdin, stdout, and stderr.
   - The serialized prompt is piped into stdin, and stdin is closed (`end()`).
   - If the caller aborts the turn, the process is promptly terminated.
3. **Response Normalization**:
   - Standard output is captured and parsed.
   - If the CLI output contains `<think>...</think>` tags (reasoning models), it is separated into an initial `reasoning` chunk sequence followed by the `text` content chunk sequence.
   - Token usage is estimated and emitted as a canonical `usage` chunk.
   - A final `finish` chunk with `{ kind: 'stop' }` signals completion to the agent loop.
