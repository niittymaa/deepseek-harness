---
kind: upgrade-guide
description: Configured external CLI routes reject unknown models and conflicting model or effort arguments.
---

# External CLI model selection

English | [中文](guide.zh.md)

## Change

Configured external CLI routes publish actual model identifiers in the chat model selector. An unknown model identifier is rejected instead of using the executable's default model. Duplicate or empty model identifiers, model identifiers equal to their provider route, and empty reasoning declarations are rejected. Explicit model selections reject conflicting model and effort overrides in base CLI arguments.

## Migration

1. In Models settings, edit each local CLI provider. The model list fetches the provider's catalog: Agy prints it, and Codex, Claude Code, and Copilot answer over their own metadata channels. The chat selector also offers discovered models with their advertised reasoning levels before they are saved.
2. Declare supported reasoning levels per model. Remove `--model`, `--effort`, `--reasoning-effort`, and Codex model configuration overrides from base `args` when choosing models in chat.
3. For a custom executable, select its CLI type or provide `modelArgs` and `effortArgs` arrays with `{model}` and `{effort}` placeholders.
4. Choose a model and effort below the chat input and send a message. Select the provider's CLI default entry to preserve its own model and effort configuration. Existing profiles without model declarations retain this default entry.
