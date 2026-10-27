/**
 * Configuration schema for the external CLI model provider.
 *
 * @module @deepseek-ai/dsh-llm-external-cli/config
 */

import z from '@deepseek-ai/schemastery'

/** Configuration options for the external CLI provider. */
export interface ExternalCliOptions {
  /** The executable name (e.g. agy, codex, claude, copilot). */
  command?: string
  /** Optional array of additional CLI arguments. */
  args?: string[]
  /** Command execution timeout in milliseconds. */
  timeoutMs?: number
  /** Whether to spawn the command within a shell environment. */
  shell?: boolean
  /** Provider route key (default: 'external-cli'). */
  provider?: string
}

/** Schemastery validator for external CLI provider options. */
export const Config: z<ExternalCliOptions> = z.object({
  command: z.string().description('The executable name (e.g. agy, codex, claude, copilot)'),
  args: z.array(z.string()).description('Optional array of additional CLI arguments'),
  timeoutMs: z.number().description('Command execution timeout in milliseconds'),
  shell: z.boolean().description('Whether to run command via shell'),
  provider: z.string().description('Provider route key (default: external-cli)'),
})
