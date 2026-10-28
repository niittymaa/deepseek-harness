/**
 * External CLI provider adapter for the DeepSeek Harness LLM seam.
 *
 * @module @deepseek-ai/dsh-llm-external-cli/adapter
 */

import {
  LlmAdapter,
  LlmError,
  ReasoningEffortId,
  type GenerateOptions,
  type LlmModelInfo,
  type LlmProviderInfo,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import type { ExternalCliModel, ExternalCliOptions } from './config.ts'
import { streamExternalCli } from './process.ts'
import { discoverCliModels } from './catalog.ts'

/** Default context window token limit for external CLI models. */
export const DEFAULT_CONTEXT_WINDOW = 128000

/** Known preset names mapped to friendly titles. */
const PRESET_NAMES: Record<string, string> = {
  agy: 'Agy CLI',
  claude: 'Claude Code CLI',
  codex: 'Codex CLI',
  copilot: 'GitHub Copilot CLI',
}

/** Refuse ambiguous configured catalogs before publishing model choices. */
function validateCatalogs(config: ExternalCliOptions): void {
  for (const [provider, profile] of Object.entries(config.providers ?? {})) {
    const seen = new Set<string>([provider])
    for (const model of profile.models ?? []) {
      if (model.id.trim().length === 0 || seen.has(model.id)) {
        throw new LlmError(`CLI model identifiers must be non-empty and unique, and cannot equal the provider identifier: ${provider}`, 'CLI_INVALID_MODELS')
      }
      seen.add(model.id)
      for (const [effort, value] of Object.entries(model.reasoningEfforts ?? {})) {
        if (effort.trim().length === 0 || (value !== null && value.trim().length === 0)) {
          throw new LlmError(`CLI reasoning levels and values must be non-empty: ${provider}/${model.id}`, 'CLI_INVALID_EFFORTS')
        }
      }
    }
  }
}

/**
 * Adapter that dispatches LLM requests to a local CLI command via stdin/stdout.
 */
export class ExternalCliAdapter extends LlmAdapter {
  private config: ExternalCliOptions

  /**
   * Create a new ExternalCliAdapter instance.
   * @param config - Provider configuration options.
   */
  constructor(config: ExternalCliOptions = {}) {
    super()
    validateCatalogs(config)
    this.config = config
  }

  /**
   * Update effective adapter configuration on live settings changes.
   * @param config - New external CLI options.
   */
  updateConfig(config: ExternalCliOptions): void {
    validateCatalogs(config)
    this.config = config
  }

  /**
   * Return display metadata for the provider route.
   * @param provider - Route identifier.
   * @returns Provider display info.
   */
  override providerInfo(provider: string): LlmProviderInfo {
    if (provider.toLowerCase() === 'cli') {
      return { id: provider, name: 'CLI' }
    }
    if (provider.toLowerCase() === 'external-cli') {
      return { id: provider, name: 'External CLI' }
    }
    const profile = this.config.providers?.[provider]
    const name = profile?.displayName
      ?? PRESET_NAMES[provider.toLowerCase()]
      ?? `${provider.charAt(0).toUpperCase() + provider.slice(1)} CLI`
    return { id: provider, name }
  }

  /**
   * List discoverable models for the external CLI provider.
   * Groups all configured CLI provider profiles under the CLI provider group.
   * @param provider - Route identifier.
   * @returns List of model descriptors.
   */
  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    const profile = this.config.providers?.[provider]
    if (profile !== undefined) {
      let discovered: ExternalCliModel[]
      try {
        discovered = await discoverCliModels(profile)
      } catch (error) {
        // The settings discovery operation reports the failure; saved models remain usable in chat.
        if ((profile.models?.length ?? 0) === 0) throw error
        discovered = []
      }
      const merged = new Map(discovered.map(model => [model.id, model]))
      for (const model of profile.models ?? []) merged.set(model.id, model)
      return Promise.resolve([
        { provider, id: provider, name: `${profile.displayName ?? provider} (CLI default)` },
        ...[...merged.values()].map(model => ({ provider, id: model.id, name: model.name ?? model.id })),
      ])
    }
    if (provider.toLowerCase() === 'cli' || provider.toLowerCase() === 'external-cli') {
      const configuredIds = Object.keys(this.config.providers ?? {})
      if (configuredIds.length > 0) {
        const models: LlmModelInfo[] = []
        for (const id of configuredIds) {
          const profile = this.config.providers?.[id]
          const displayName = profile?.displayName
            ?? PRESET_NAMES[id.toLowerCase()]
            ?? `${id.charAt(0).toUpperCase() + id.slice(1)} CLI`
          models.push({
            provider,
            id,
            name: displayName,
          })
        }
        return Promise.resolve(models)
      }

      // When no user profiles are configured in settings yet, list known CLI tools
      const known = ['agy', 'codex', 'claude', 'copilot']
      const models: LlmModelInfo[] = known.map(id => ({
        provider,
        id,
        name: PRESET_NAMES[id] ?? `${id.charAt(0).toUpperCase() + id.slice(1)} CLI`,
      }))
      if (this.config.command !== undefined && !known.includes(this.config.command.toLowerCase())) {
        models.unshift({
          provider,
          id: this.config.command,
          name: `${this.config.command} (CLI)`,
        })
      }
      return Promise.resolve(models)
    }

    return Promise.resolve([])
  }

  /**
   * Resolve exact model metadata without requiring network lookups.
   * @param provider - Route identifier.
   * @param model - Model identifier.
   * @param _signal - Optional abort signal.
   * @returns Resolved model metadata with default context window.
   */
  override resolveModel(
    provider: string,
    model: string,
    _signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    const profile = this.config.providers?.[provider] ?? this.config.providers?.[model]
    const selected = profile?.models?.find(entry => entry.id === model)
    const name = selected?.name ?? (selected === undefined ? profile?.displayName : model)
      ?? PRESET_NAMES[model.toLowerCase()]
      ?? PRESET_NAMES[provider.toLowerCase()]
      ?? model
    return Promise.resolve({
      provider,
      id: model,
      name,
      context: { contextWindow: DEFAULT_CONTEXT_WINDOW },
      ...selected?.reasoningEfforts === undefined ? {} : {
        reasoning: { efforts: Object.keys(selected.reasoningEfforts).map(id => ({ id: ReasoningEffortId(id), name: id })) },
      },
    })
  }

  /**
   * Stream model chunks by invoking the configured CLI tool via stdin/stdout.
   * @param options - Full generate options.
   * @returns Async iterable yielding canonical StreamChunks.
   */
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const config = this.config
    const profile = config.providers?.[options.provider]
    if (profile !== undefined && options.model !== options.provider
      && !profile.models?.some(model => model.id === options.model)) {
      const discovered = await discoverCliModels(profile, options.signal)
      const models = new Map(discovered.map(model => [model.id, model]))
      for (const model of profile.models ?? []) models.set(model.id, model)
      yield* streamExternalCli({ ...config, providers: { ...config.providers,
        [options.provider]: { ...profile, models: [...models.values()] },
      } }, options)
      return
    }
    yield* streamExternalCli(config, options)
  }
}
