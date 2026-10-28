import { afterEach, describe, expect, it, vi } from 'vitest'
import { execFile } from 'node:child_process'
import { BlockAssembler } from '@deepseek-ai/dsh-llm'
import { ExternalCliAdapter } from '../src/adapter.ts'
import { cliType, discoverCliModels, mergeModels } from '../src/catalog.ts'

vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(), execFile: vi.fn(),
}))

afterEach(() => { vi.resetAllMocks() })

/** Complete the mocked executable without starting a process. */
function output(text: string): void {
  vi.mocked(execFile).mockImplementation((_command, _args, _options, callback) => {
    if (typeof callback === 'function') callback(null, text, '')
    return {} as ReturnType<typeof execFile>
  })
}

describe('CLI catalog discovery', () => {
  it('recognizes executable paths and an explicit protocol', () => {
    expect(cliType({ command: 'C:\\Tools\\CODEX.EXE' })).toBe('codex')
    expect(cliType({ command: 'wrapper', cliType: 'agy' })).toBe('agy')
    expect(cliType({ command: 'unknown' })).toBe('custom')
  })

  it('parses Agy tab-separated models, preserving names and order and removing duplicates', async () => {
    output('Fetching available models...\nfirst\tFirst model\nsecond\tSecond model\nfirst\tDuplicate\n')
    expect(await discoverCliModels({ command: 'agy' })).toEqual([
      { id: 'first', name: 'First model' }, { id: 'second', name: 'Second model' },
    ])
    expect(execFile).toHaveBeenCalledWith('agy', ['models'], expect.objectContaining({ timeout: 120000, maxBuffer: 1048576 }), expect.any(Function))
  })

  it.each(['', 'Unexpected output', 'bad id\tName'])('rejects an empty or invalid catalog: %s', async (text) => {
    output(text)
    await expect(discoverCliModels({ command: 'agy' })).rejects.toThrow()
  })

  it('folds the identifiers Agy publishes per level into one model with its levels', async () => {
    output([
      'gemini-4-argon-medium\tGemini 4 Argon (Medium)',
      'gemini-4-argon-high\tGemini 4 Argon (High)',
      'gemini-4-argon-low\tGemini 4 Argon (Low)',
      'gemini-3.8-flash-high\tGemini 3.8 Flash (High)',
      'gemini-3.8-flash-low\tGemini 3.8 Flash (Low)',
      'gpt-oss-120b-medium\tGPT-OSS 120B (Medium)',
      'plain-model\tPlain model',
    ].join('\n'))
    expect(await discoverCliModels({ command: 'agy' })).toEqual([
      {
        id: 'gemini-4-argon',
        name: 'Gemini 4 Argon',
        reasoningEfforts: { low: 'low', medium: 'medium', high: 'high' },
      },
      { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', reasoningEfforts: { low: 'low', high: 'high' } },
      // One published level is not a family: the identifier stays as the CLI lists it.
      { id: 'gpt-oss-120b-medium', name: 'GPT-OSS 120B (Medium)' },
      { id: 'plain-model', name: 'Plain model' },
    ])
  })

  it('keeps a model name that publishes no level suffix', async () => {
    output('model-a-low\tModel A\nmodel-a-high\t\n')
    expect(await discoverCliModels({ command: 'agy' })).toEqual([
      { id: 'model-a', name: 'Model A', reasoningEfforts: { low: 'low', high: 'high' } },
    ])
  })

  it('keeps a name that carries only the level', async () => {
    output('model-b-low\t(Low)\nmodel-b-high\t(High)\n')
    expect(await discoverCliModels({ command: 'agy' })).toEqual([
      { id: 'model-b', name: '(Low)', reasoningEfforts: { low: 'low', high: 'high' } },
    ])
  })

  it('starts no command for a provider that publishes no catalog', async () => {
    expect(await discoverCliModels({ command: 'my-cli', cliType: 'custom' })).toEqual([])
    expect(execFile).not.toHaveBeenCalled()
  })

  it('forwards cancellation and configured timeout and output bounds', async () => {
    output('first\tFirst\n')
    const controller = new AbortController()
    await discoverCliModels({ command: 'agy', timeoutMs: 25, discoveryMaxBytes: 512 }, controller.signal)
    expect(execFile).toHaveBeenCalledWith('agy', ['models'], expect.objectContaining({ signal: controller.signal, timeout: 25, maxBuffer: 512 }), expect.any(Function))
  })
})


it('keeps discovered metadata a configured entry does not declare', () => {
  expect(mergeModels(
    [{ id: 'discovered', name: 'Discovered name', reasoningEfforts: { low: 'low' } }],
    [{ id: 'discovered' }, { id: 'configured', name: 'Configured', reasoningEfforts: { high: 'deep' } }],
  )).toEqual([
    { id: 'discovered', name: 'Discovered name', reasoningEfforts: { low: 'low' } },
    { id: 'configured', name: 'Configured', reasoningEfforts: { high: 'deep' } },
  ])
})

it('lets a configured name and reasoning levels replace the discovered ones', () => {
  expect(mergeModels(
    [{ id: 'shared', name: 'Discovered', reasoningEfforts: { low: 'low' } }],
    [{ id: 'shared', name: 'Configured', reasoningEfforts: { high: 'high' } }],
  )).toEqual([{ id: 'shared', name: 'Configured', reasoningEfforts: { high: 'high' } }])
})


it('merges discovered models with manual names and reasoning settings', async () => {
  output('first\tDiscovered name\nsecond\tSecond\n')
  const adapter = new ExternalCliAdapter({ providers: { agy: { command: 'agy', models: [
    { id: 'first', name: 'Manual name', reasoningEfforts: { high: 'high' } },
  ] } } })
  expect(await adapter.listModels('agy')).toEqual([
    { provider: 'agy', id: 'first', name: 'Manual name' }, { provider: 'agy', id: 'second', name: 'Second' },
    { provider: 'agy', id: 'agy', name: 'agy (CLI default)' },
  ])
  expect(await adapter.resolveModel('agy', 'first')).toMatchObject({ reasoning: { efforts: [{ id: 'high', name: 'high' }] } })
})

it('reports discovery failures while retaining manually configured chat models', async () => {
  vi.mocked(execFile).mockImplementation((_command, _args, _options, callback) => {
    if (typeof callback === 'function') callback(new Error('CLI unavailable'), '', '')
    return {} as ReturnType<typeof execFile>
  })
  await expect(discoverCliModels({ command: 'agy' })).rejects.toThrow('CLI unavailable')
  const adapter = new ExternalCliAdapter({ providers: { agy: { command: 'agy', models: [{ id: 'manual' }] } } })
  expect(await adapter.listModels('agy')).toContainEqual({ provider: 'agy', id: 'manual', name: 'manual' })
  await expect(new ExternalCliAdapter({ providers: { agy: { command: 'agy' } } }).listModels('agy')).rejects.toThrow('CLI unavailable')
})


it('uses the Agy executable for an explicit protocol and the identifier for an empty display name', async () => {
  output('first\t  \n')
  expect(await discoverCliModels({ cliType: 'agy' })).toEqual([{ id: 'first', name: 'first' }])
  expect(execFile).toHaveBeenCalledWith('agy', ['models'], expect.any(Object), expect.any(Function))
})

describe('CLI default levels', () => {
  it.each([
    ['copilot', ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']],
    ['codex', ['low', 'medium', 'high', 'xhigh', 'max']],
    ['claude', ['low', 'medium', 'high', 'xhigh', 'max']],
    ['agy', ['low', 'medium', 'high', 'xhigh', 'max']],
  ] as const)('offers the levels %s applies to its own configured model', async (route, levels) => {
    output('first\tFirst\n')
    const adapter = new ExternalCliAdapter({ providers: { [route]: { command: route } } })
    expect((await adapter.resolveModel(route, route)).reasoning?.efforts.map(level => level.id)).toEqual([...levels])
  })

  it('offers the levels of the route an alias entry names', async () => {
    const adapter = new ExternalCliAdapter({ providers: { agy: { command: 'agy', displayName: 'Agy CLI' } } })
    expect(await adapter.resolveModel('cli', 'agy')).toMatchObject({
      name: 'Agy CLI',
      reasoning: { efforts: [{ id: 'low' }, { id: 'medium' }, { id: 'high' }, { id: 'xhigh' }, { id: 'max' }] },
    })
  })

  it('offers no levels for a model it cannot describe or a custom CLI', async () => {
    const adapter = new ExternalCliAdapter({ providers: { mine: { command: 'my-cli' } } })
    expect((await adapter.resolveModel('mine', 'mine')).reasoning).toBeUndefined()
    expect((await adapter.resolveModel('missing', 'missing')).reasoning).toBeUndefined()
  })

  it('names the dialect by route, or by the aliased tool without a configured command', async () => {
    const adapter = new ExternalCliAdapter({ providers: { agy: { displayName: 'Agy CLI' }, codex: { displayName: 'Codex CLI' } } })
    expect((await adapter.resolveModel('agy', 'agy')).reasoning?.efforts.map(level => level.id)).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    expect((await adapter.resolveModel('cli', 'codex')).reasoning?.efforts.map(level => level.id)).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
  })
})


it('executes an automatically discovered model on its configured provider', async () => {
  output('discovered\tDiscovered model\n')
  const adapter = new ExternalCliAdapter({ providers: { route: {
    command: process.execPath, cliType: 'agy', modelArgs: ['{model}'],
    args: ['-e', 'process.stdin.resume(); process.stdin.on("end", () => process.stdout.write(process.argv[1]))', '--'],
  } } })
  const assembler = new BlockAssembler()
  for await (const chunk of adapter.stream({ provider: 'route', model: 'discovered', messages: [] })) assembler.push(chunk)
  expect(assembler.blocks()).toEqual([{ type: 'text', text: 'discovered' }])
})
