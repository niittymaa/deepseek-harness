/** External CLI model discovery and executable protocol selection.
 * @module @deepseek-ai/dsh-llm-external-cli/catalog
 */
import { execFile } from 'node:child_process'
import { LlmError } from '@deepseek-ai/dsh-llm'
import type { ExternalCliModel, ExternalCliProviderProfile } from './config.ts'

/** Resolve the CLI protocol independently of an executable's directory.
 * @param profile - Configured executable and optional explicit protocol.
 * @returns The CLI argument protocol.
 */
export function cliType(profile: ExternalCliProviderProfile): NonNullable<ExternalCliProviderProfile['cliType']> {
  if (profile.cliType !== undefined) return profile.cliType
  const executable = profile.command?.replace(/\\/g, '/').split('/').at(-1)?.replace(/\.(exe|cmd|bat)$/i, '').toLowerCase()
  switch (executable) {
    case 'agy': case 'claude': case 'codex': case 'copilot': return executable
    default: return 'custom'
  }
}

/** Fetch an Agy catalog without issuing a generation request.
 * @param profile - Executable and discovery limits.
 * @param signal - Optional cancellation.
 * @returns Validated model identifiers and names.
 */
export async function discoverCliModels(profile: ExternalCliProviderProfile, signal?: AbortSignal): Promise<ExternalCliModel[]> {
  if (cliType(profile) !== 'agy') return []
  const output = await new Promise<string>((resolve, reject) => {
    execFile(profile.command ?? 'agy', ['models'], {
      timeout: profile.timeoutMs ?? 120000,
      maxBuffer: profile.discoveryMaxBytes ?? 1048576,
      shell: profile.shell ?? false,
      ...signal === undefined ? {} : { signal },
    }, (error, stdout) => {
      if (error !== null) reject(new LlmError(`Could not fetch CLI models: ${error.message}`, 'CLI_DISCOVERY_FAILED'))
      else resolve(stdout)
    })
  })
  const models: ExternalCliModel[] = []
  const seen = new Set<string>()
  for (const line of output.split(/\r?\n/)) {
    if (line.trim().length === 0 || line.startsWith('Fetching ')) continue
    const [id, ...name] = line.split('\t')
    if (id === undefined || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(id) || name.length === 0) {
      throw new LlmError('The CLI returned an unsupported model list. Add models in settings or update the CLI.', 'CLI_INVALID_CATALOG')
    }
    if (!seen.has(id)) models.push({ id, name: name.join('\t').trim() || id })
    seen.add(id)
  }
  if (models.length === 0) throw new LlmError('The CLI returned no models. Check CLI authentication and retry.', 'CLI_EMPTY_CATALOG')
  return models
}
