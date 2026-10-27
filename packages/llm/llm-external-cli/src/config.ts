/**
 * Configuration schema for the external CLI model provider.
 *
 * @module @deepseek-ai/dsh-llm-external-cli/config
 */

import type { Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

/** Configuration profile for one external CLI provider route. */
export interface ExternalCliProviderProfile {
  /** The executable name (e.g. agy, codex, claude, copilot). */
  command?: string
  /** Optional array of additional CLI arguments. */
  args?: string[]
  /** Command execution timeout in milliseconds. */
  timeoutMs?: number
  /** Whether to spawn the command within a shell environment. */
  shell?: boolean
  /** Human-facing display name. */
  displayName?: string
}

/** Schemastery validator for one CLI provider profile. */
export const ExternalCliProviderProfileSchema: z<ExternalCliProviderProfile> = z.object({
  command: z.string().description('The executable name (e.g. agy, codex, claude, copilot)'),
  args: z.array(z.string()).description('Optional array of additional CLI arguments'),
  timeoutMs: z.number().description('Command execution timeout in milliseconds'),
  shell: z.boolean().description('Whether to run command via shell'),
  displayName: z.string().description('Human-facing display name'),
})

/** Configuration options for the external CLI provider plugin. */
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
  /** Configured provider profiles keyed by route. */
  providers?: Record<string, ExternalCliProviderProfile>
}

/** Plugin configuration schema for cordis loader. */
export interface Config {
  command?: string
  args?: string[]
  timeoutMs?: number
  shell?: boolean
  provider?: string
  providers: Volatile<Record<string, ExternalCliProviderProfile>>
}

/** Schemastery validator for external CLI plugin configuration. */
export const Config = z.object({
  command: z.string().description('The executable name (e.g. agy, codex, claude, copilot)'),
  args: z.array(z.string()).description('Optional array of additional CLI arguments'),
  timeoutMs: z.number().description('Command execution timeout in milliseconds'),
  shell: z.boolean().description('Whether to run command via shell'),
  provider: z.string().description('Provider route key (default: external-cli)'),
  providers: z.dict(ExternalCliProviderProfileSchema).default({}).volatile(),
})
