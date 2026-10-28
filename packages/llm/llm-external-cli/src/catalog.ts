/** External CLI model discovery and executable protocol selection.
 * @module @deepseek-ai/dsh-llm-external-cli/catalog
 */
import { execFile } from 'node:child_process'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { discoverRpcModels } from './rpc-catalog.ts'
import { DEFAULT_DISCOVERY_BYTES, DEFAULT_DISCOVERY_TIMEOUT_MS } from './config.ts'
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

/** Reasoning levels each CLI accepts for the model it configures itself, as its own help or catalog states. */
const CLI_EFFORT_LEVELS: Record<NonNullable<ExternalCliProviderProfile['cliType']>, readonly string[]> = {
  agy: ['low', 'medium', 'high', 'xhigh', 'max'],
  claude: ['low', 'medium', 'high', 'xhigh', 'max'],
  codex: ['low', 'medium', 'high', 'xhigh', 'max'],
  copilot: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
  // A custom executable documents no level vocabulary; declare levels on its configured models instead.
  custom: [],
}

/**
 * Reasoning levels the CLI default entry offers. That entry sends no model, so
 * these are the levels the CLI applies to its own configured model.
 * @param profile - Configured executable and optional explicit protocol.
 * @returns Level identifiers in CLI order, empty when the dialect claims none.
 */
export function cliEffortLevels(profile: ExternalCliProviderProfile): readonly string[] {
  return CLI_EFFORT_LEVELS[cliType(profile)]
}

/** Fetch a native CLI catalog without issuing a generation request.
 *
 * Agy prints its catalog for `agy models`; Codex, Claude Code, and Copilot
 * answer over their own metadata channels, so the executable is started in
 * catalog mode and stopped before it serves a turn. An empty native catalog is
 * a valid answer: Copilot advertises no text models on some installations, and
 * the CLI default entry still serves requests.
 * @param profile - Executable and discovery limits.
 * @param signal - Optional cancellation.
 * @returns Validated model identifiers, names, and advertised reasoning levels.
 */
export async function discoverCliModels(profile: ExternalCliProviderProfile, signal?: AbortSignal): Promise<ExternalCliModel[]> {
  const type = cliType(profile)
  if (type === 'custom') return []
  if (type !== 'agy') return discoverRpcModels(profile, type, signal)
  const output = await new Promise<string>((resolve, reject) => {
    execFile(profile.command ?? 'agy', ['models'], {
      timeout: profile.timeoutMs ?? DEFAULT_DISCOVERY_TIMEOUT_MS,
      maxBuffer: profile.discoveryMaxBytes ?? DEFAULT_DISCOVERY_BYTES,
      shell: profile.shell ?? false,
      ...signal === undefined ? {} : { signal },
    }, (error, stdout) => {
      if (error !== null) reject(new LlmError(`Could not fetch CLI models: ${error.message}`, 'CLI_DISCOVERY_FAILED'))
      else resolve(stdout)
    })
  })
  const models: { id: string; name: string }[] = []
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
  return groupLevelModels(models)
}

/** Reasoning levels Agy appends to a model identifier, in `--effort` order. */
const AGY_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

/** The level a model identifier ends with, when it names one. */
function levelOf(id: string): string | undefined {
  const lower = id.toLowerCase()
  return AGY_LEVELS.find(level => lower.endsWith(`-${level}`))
}

/** The model name without the parenthesized level Agy appends to it. */
function withoutLevel(name: string): string {
  const stripped = name.replace(/\s*\((?:low|medium|high|xhigh|max)\)$/i, '').trim()
  return stripped.length === 0 ? name : stripped
}

/**
 * Fold Agy's one-identifier-per-level catalog into one entry per model. Agy
 * lists `gemini-4-argon-low`, `-medium` and `-high` separately and accepts the
 * level-free identifier with `--effort`, so a family becomes one model whose
 * efforts name its levels. A model with a single level keeps its identifier.
 * @param models - Catalog rows in CLI order.
 * @returns One entry per model, each at the position of its first identifier.
 */
function groupLevelModels(models: readonly { id: string; name: string }[]): ExternalCliModel[] {
  const levelsByModel = new Map<string, string[]>()
  for (const model of models) {
    const level = levelOf(model.id)
    if (level === undefined) continue
    const base = model.id.slice(0, -(level.length + 1))
    levelsByModel.set(base, [...levelsByModel.get(base) ?? [], level])
  }
  const families = new Map([...levelsByModel].filter(([, levels]) => levels.length > 1).map(([base, levels]) => [
    base,
    Object.fromEntries(AGY_LEVELS.filter(level => levels.includes(level)).map(level => [level, level])),
  ]))
  const grouped: ExternalCliModel[] = []
  const seen = new Set<string>()
  for (const model of models) {
    const level = levelOf(model.id)
    const base = level === undefined ? '' : model.id.slice(0, -(level.length + 1))
    const family = families.get(base)
    if (family === undefined) {
      grouped.push(model)
      continue
    }
    if (seen.has(base)) continue
    seen.add(base)
    grouped.push({ id: base, name: withoutLevel(model.name), reasoningEfforts: family })
  }
  return grouped
}

/**
 * Combine a discovered catalog with the models a profile configures. A
 * configured entry wins for the name and reasoning levels it declares and
 * keeps the discovered ones it leaves unset, so adopting a discovered model in
 * settings does not discard the levels its CLI advertises.
 * @param discovered - Catalog last discovered for the route, in CLI order.
 * @param configured - Models the profile declares.
 * @returns One entry per model identifier, discovered models first.
 */
export function mergeModels(discovered: readonly ExternalCliModel[], configured: readonly ExternalCliModel[]): ExternalCliModel[] {
  const merged = new Map(discovered.map(model => [model.id, model]))
  for (const model of configured) {
    const found = merged.get(model.id)
    const name = model.name ?? found?.name
    const reasoningEfforts = model.reasoningEfforts ?? found?.reasoningEfforts
    merged.set(model.id, {
      id: model.id,
      ...name === undefined ? {} : { name },
      ...reasoningEfforts === undefined ? {} : { reasoningEfforts },
    })
  }
  return [...merged.values()]
}
