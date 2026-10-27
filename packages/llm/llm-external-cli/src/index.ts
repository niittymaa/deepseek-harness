/**
 * External CLI provider plugin for DeepSeek Harness.
 * Routes model calls to local LLM CLIs (Agy, Codex, Claude Code, Copilot) via stdin/stdout.
 *
 * @module @deepseek-ai/dsh-llm-external-cli
 */

import type { Context } from '@deepseek-ai/cordis'
import { ExternalCliAdapter } from './adapter.ts'
import type { ExternalCliOptions } from './config.ts'

export { ExternalCliAdapter, DEFAULT_CONTEXT_WINDOW } from './adapter.ts'
export { Config, type ExternalCliOptions } from './config.ts'
export { formatPrompt, parseThinkTags, resolveCommandAndArgs, streamExternalCli } from './process.ts'

/** Cordis plugin name. */
export const name = 'llm-external-cli'

/** Required service dependencies. */
export const inject = ['llm']

/**
 * Mount the external CLI provider plugin.
 * Registers the ExternalCliAdapter on routes 'external-cli', 'agy', 'codex', 'claude', and 'copilot'.
 * @param ctx - Cordis context with LLM service.
 * @param config - Provider configuration options.
 */
export function apply(ctx: Context, config: ExternalCliOptions = {}): void {
  const primaryProvider = config.provider ?? 'external-cli'
  const adapter = new ExternalCliAdapter(config)
  const routes = Array.from(new Set([primaryProvider, 'external-cli', 'agy', 'codex', 'claude', 'copilot']))

  ctx.llm.registerAdapter(routes, adapter)
  ctx.llm.registerConfigurableProviders([
    {
      provider: primaryProvider,
      displayName: 'External CLI',
      settingsNs: name,
      settingsPath: [],
    },
  ])
}

Object.assign(apply, { inject })

export default apply
