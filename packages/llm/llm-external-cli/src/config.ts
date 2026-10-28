/**
 * Configuration schema for the external CLI model provider.
 *
 * @module @deepseek-ai/dsh-llm-external-cli/config
 */

import type { Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

/** One selectable external CLI model. */
export interface ExternalCliModel {
  /** Identifier passed to the CLI model option. */
  id: string
  /** Display name in the chat selector. */
  name?: string
  /** Supported reasoning levels mapped to CLI values. */
  reasoningEfforts?: Record<string, string | null>
}

/** Selectable model settings. */
const ModelSchema: z<ExternalCliModel> = z.object({
  id: z.string().required(),
  name: z.string(),
  reasoningEfforts: z.dict(z.union([z.string(), z.const(null)])),
})

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
  /** Models offered in the chat selector. */
  models?: ExternalCliModel[]
  /** Maximum discovery output size in bytes. */
  discoveryMaxBytes?: number
  /** CLI protocol, independent of executable filename. */
  cliType?: 'agy' | 'claude' | 'codex' | 'copilot' | 'custom'
  /** Custom model arguments; {model} is replaced in each argument. */
  modelArgs?: string[]
  /** Custom effort arguments; {effort} is replaced in each argument. */
  effortArgs?: string[]
}

/** Schemastery validator for one CLI provider profile. */
export const ExternalCliProviderProfileSchema: z<ExternalCliProviderProfile> = z.object({
  command: z.string().description('The executable name (e.g. agy, codex, claude, copilot)'),
  args: z.array(z.string()).description('Optional array of additional CLI arguments'),
  timeoutMs: z.number().description('Command execution timeout in milliseconds'),
  shell: z.boolean().description('Whether to run command via shell'),
  displayName: z.string().description('Human-facing display name'),
  models: z.array(ModelSchema),
  discoveryMaxBytes: z.number().min(1),
  cliType: z.union(['agy', 'claude', 'codex', 'copilot', 'custom']),
  modelArgs: z.array(z.string()),
  effortArgs: z.array(z.string()),
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
  /** Executable name or path. */
  command?: string
  /** Arguments replacing the executable defaults. */
  args?: string[]
  /** Maximum execution duration in milliseconds. */
  timeoutMs?: number
  /** Whether the executable runs through a shell. */
  shell?: boolean
  /** Primary provider route identifier. */
  provider?: string
  /** Live provider profiles keyed by route identifier. */
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
