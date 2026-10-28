/**
 * External CLI provider plugin for DeepSeek Harness.
 * Routes model calls to local LLM CLIs (Agy, Codex, Claude Code, Copilot) via stdin/stdout.
 *
 * @module @deepseek-ai/dsh-llm-external-cli
 */

import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { Context } from '@deepseek-ai/cordis'
import type { AdapterRegistrationHandle, DirectoryRegistrationHandle, LlmConfigurableProvider } from '@deepseek-ai/dsh-llm'
import { ExternalCliAdapter } from './adapter.ts'
import type { Config, ExternalCliOptions, ExternalCliProviderProfile } from './config.ts'

export { ExternalCliAdapter, DEFAULT_CONTEXT_WINDOW } from './adapter.ts'
export { Config, type ExternalCliOptions, type ExternalCliProviderProfile } from './config.ts'
export { formatPrompt, parseThinkTags, resolveCommandAndArgs, streamExternalCli } from './process.ts'

/** Cordis plugin name. */
export const name = 'llm-external-cli'

/** Required service dependencies. */
export const inject = ['llm']

/**
 * Mount the external CLI provider plugin.
 * Registers the ExternalCliAdapter on preset routes and any user-configured routes.
 * @param ctx - Cordis context with LLM service.
 * @param config - Provider configuration options.
 */
export function apply(ctx: Context, config: Config | ExternalCliOptions = {}): void {
  ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })

  const getEffectiveConfig = (): ExternalCliOptions => {
    const rawProviders = 'providers' in config && config.providers !== undefined
      ? typeof (config.providers as { get?: () => unknown }).get === 'function'
        ? (config.providers as { get: () => unknown }).get()
        : config.providers
      : undefined
    const effective: ExternalCliOptions = {
      providers: (rawProviders as Record<string, ExternalCliProviderProfile> | undefined) ?? {},
    }
    if (config.command !== undefined) effective.command = config.command
    if (config.args !== undefined) effective.args = config.args
    if (config.timeoutMs !== undefined) effective.timeoutMs = config.timeoutMs
    if (config.shell !== undefined) effective.shell = config.shell
    if (config.provider !== undefined) effective.provider = config.provider
    return effective
  }

  let effectiveConfig = getEffectiveConfig()
  const primaryProvider = effectiveConfig.provider ?? 'external-cli'
  const adapter = new ExternalCliAdapter(effectiveConfig)

  let adapterRegistration: AdapterRegistrationHandle | undefined
  let directoryRegistration: DirectoryRegistrationHandle | undefined

  const ensureRegistrations = (): void => {
    effectiveConfig = getEffectiveConfig()
    adapter.updateConfig(effectiveConfig)

    const configuredIds = Object.keys(effectiveConfig.providers ?? {})
    const allRoutes = Array.from(new Set([
      primaryProvider,
      'external-cli',
      'agy',
      'codex',
      'claude',
      'copilot',
      ...configuredIds,
    ]))

    if (adapterRegistration === undefined) {
      adapterRegistration = ctx.llm.registerAdapter(allRoutes, adapter)
    } else {
      adapterRegistration.replace(allRoutes)
    }

    const directoryEntries: LlmConfigurableProvider[] = configuredIds.length > 0
      ? configuredIds.map((id) => {
        const profile = effectiveConfig.providers?.[id]
        return {
          provider: id,
          displayName: profile?.displayName ?? `${id.charAt(0).toUpperCase() + id.slice(1)} CLI`,
          settingsNs: name,
          settingsPath: ['providers', id],
          declared: true,
        }
      })
      : [
        {
          provider: primaryProvider,
          displayName: 'External CLI',
          settingsNs: name,
          settingsPath: ['providers', primaryProvider],
          declared: true,
        },
      ]

    if (directoryRegistration === undefined) {
      directoryRegistration = ctx.llm.registerConfigurableProviders(directoryEntries)
    } else {
      directoryRegistration.replace(directoryEntries)
    }
  }

  ensureRegistrations()

  ctx.on('loader/volatile-update', () => {
    try {
      ensureRegistrations()
    } catch (error) {
      ctx.logger.error('llm-external-cli: failed to update volatile registrations', error)
    }
  })
}
