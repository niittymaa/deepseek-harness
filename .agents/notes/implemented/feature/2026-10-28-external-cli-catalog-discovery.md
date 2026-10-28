# Agent Note: External CLI routes discover each CLI's native model catalog

Status: implemented

English | [中文](2026-10-28-external-cli-catalog-discovery.zh.md)

## Problem

A local CLI route offered the models its `models` setting declared, so a Codex, Claude Code, or Copilot user had to type identifiers the installed CLI already knows, and to redeclare each model's reasoning levels by hand. Only Agy printed a catalog (`agy models`). Asking a CLI for its catalog must not consume a subscription turn, start a coding session, or need credentials the harness does not hold.

## Decision

`discoverCliModels` reads the catalog each CLI publishes over its own metadata channel and returns `{ id, name?, reasoningEfforts? }` entries:

- Codex: `codex app-server`, an `initialize` request, the `initialized` notification, then `model/list` with `includeHidden: false`, following `nextCursor` pages. Models come from `data[].model` with `displayName`, and levels from `supportedReasoningEfforts[].reasoningEffort`.
- Claude Code: `claude --print --input-format stream-json --output-format stream-json --verbose --no-session-persistence` and one `initialize` control request. The control response carries `models[]` with `value`, `displayName`, and `supportedEffortLevels[]`.
- Copilot: `copilot --headless --no-auto-update --stdio`, `connect` with the `clientInfo` editor fields the channel validates, then `models.list` over `Content-Length` frames. Models come from `models[]` with `id` and `name`.

Each channel exchanges metadata only: no prompt is written, and the process is stopped once the catalog settles, on failure, or when the caller's signal aborts. The profile's `timeoutMs` (default 120 s) and `discoveryMaxBytes` (default 1 MiB, counted over standard output and standard error) bound the interrogation, and every refusal carries one diagnostic code: `CLI_TIMEOUT`, `CLI_CATALOG_TOO_LARGE`, `CLI_INVALID_CATALOG`, `CLI_DISCOVERY_FAILED`, or `ABORTED`.

`ExternalCliAdapter` keeps the catalog last read for each route. `listModels` refreshes it, `resolveModel` and `stream` read it, and a settings update clears it. The chat selector therefore offers discovered identifiers and their advertised reasoning levels before they are saved, and a request for a discovered model resolves its level arguments from the same catalog instead of starting a second interrogation. `mergeModels` lets a configured entry replace the name and levels it declares and keeps the discovered ones it leaves unset.

An empty native catalog is a valid answer. Copilot advertises no text models on some installations, so its route lists the CLI default entry and its configured models. Agy keeps `CLI_EMPTY_CATALOG` because empty `agy models` output means the invocation failed rather than that the CLI disclaims every model.

## Alternatives considered

- **Parse `--help`, `--version`, or another text output.** Rejected: those texts are presentation, so a wording or locale change breaks the parse, and none of them discloses reasoning levels.
- **Read the catalog from a model request's response metadata.** Rejected: it consumes a subscription turn and may need permissions or credentials the user has not granted.
- **Discover inside `resolveModel` on every call.** Rejected: `resolveModelInfo` runs on the request path for compaction, subagents, and image reads, so that would start the CLI once per request.
- **Carry the reasoning levels through `LlmDiscoveredModel` into Models settings.** Rejected: that type describes HTTP catalog listings, where a level is a model capability rather than the CLI argument value a `{effort}` substitution sends. The settings editor stores a level map once it has a reason to own one.
- **Leave discovery to the Models settings editor.** Rejected: the chat selector would still offer only saved models, and the CLI default entry would stay the only unsaved choice.

## Consequences

- Opening the model menu starts one short-lived CLI process per configured route: 0.2-1 s for Codex, 0.4 s for Claude Code, and 2 s for Copilot on the development machine.
- Discovered levels live in the adapter's per-route catalog, so the editable Models entry stays a name and an optional level map. A saved entry keeps the levels its CLI advertises until the entry declares its own.
- A CLI release that renames a method, a field, or the connection metadata fails the route's listing with `CLI_INVALID_CATALOG` or `CLI_DISCOVERY_FAILED`; configured models remain selectable in chat, and the message names the CLI version or authentication to check.
- A route whose CLI starts slowly delays the model menu by that start, and every menu open pays it again.

## Testing

Unit coverage drives a scripted child process through each protocol's handshake, pagination, both framings, malformed payloads, bounds, timeout, abort, spawn failure, early exit, and teardown. The three channels were verified against codex-cli 0.164.0, Claude Code 2.1.311, and GitHub Copilot CLI 1.0.105 on Windows.

## Related

The [model selection upgrade guide](../../../../docs/upgrade-guide/v0.2.1-rc.3/external-cli-model-selection/guide.md) owns what users must change, and the [package README](../../../../packages/llm/llm-external-cli/README.md) owns the configuration surface.
