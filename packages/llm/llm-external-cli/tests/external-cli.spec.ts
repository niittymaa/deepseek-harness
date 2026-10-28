import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { BlockAssembler, LlmRuntime, createUserMessage, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import { ExternalCliAdapter, DEFAULT_CONTEXT_WINDOW } from '../src/adapter.ts'
import { formatPrompt, parseThinkTags, resolveCommandAndArgs } from '../src/process.ts'
import * as LlmExternalCli from '../src/index.ts'

describe('formatPrompt', () => {
  it('formats single user text message for completion mode without role wrapper', () => {
    const options: GenerateOptions = {
      provider: 'external-cli',
      model: 'claude',
      messages: [
        createUserMessage({
          content: [{ type: 'text', text: 'Complete this sentence: In a galaxy far' }],
          source: { kind: 'user' },
        }),
      ],
    }
    const prompt = formatPrompt(options)
    expect(prompt).toBe('Complete this sentence: In a galaxy far')
  })

  it('formats multi-turn chat messages with role headers', () => {
    const options: GenerateOptions = {
      provider: 'external-cli',
      model: 'claude',
      system: 'You are a helpful coding assistant.',
      messages: [
        createUserMessage({
          content: [{ type: 'text', text: 'Hello' }],
          source: { kind: 'user' },
        }),
      ],
    }
    const prompt = formatPrompt(options)
    expect(prompt).toContain('[System]\nYou are a helpful coding assistant.')
    expect(prompt).toContain('[User]\nHello')
    expect(prompt).toContain('[Assistant]\n')
  })
})

describe('parseThinkTags', () => {
  it('returns content directly when no think tags are present', () => {
    const parsed = parseThinkTags('Just a direct response.')
    expect(parsed.reasoning).toBeUndefined()
    expect(parsed.content).toBe('Just a direct response.')
  })

  it('extracts reasoning and content when think tags are present', () => {
    const parsed = parseThinkTags('<think>\nI am pondering the solution...\n</think>\nHere is the answer.')
    expect(parsed.reasoning).toBe('I am pondering the solution...')
    expect(parsed.content).toBe('Here is the answer.')
  })
})

describe('resolveCommandAndArgs', () => {
  it('uses explicit config command and args', () => {
    const resolved = resolveCommandAndArgs(
      { command: 'custom-cli', args: ['--custom-flag', 'val'] },
      { provider: 'external-cli', model: 'any-model', messages: [] },
    )
    expect(resolved.command).toBe('custom-cli')
    expect(resolved.args).toEqual(['--custom-flag', 'val'])
  })

  it('defaults to known CLI defaults when args are omitted', () => {
    const claude = resolveCommandAndArgs({}, { provider: 'external-cli', model: 'claude', messages: [] })
    expect(claude.command).toBe('claude')
    expect(claude.args).toEqual(['--print'])

    const codex = resolveCommandAndArgs({}, { provider: 'external-cli', model: 'codex', messages: [] })
    expect(codex.command).toBe('codex')
    expect(codex.args).toEqual(['exec'])

    const agy = resolveCommandAndArgs({}, { provider: 'external-cli', model: 'agy', messages: [] })
    expect(agy.command).toBe('agy')
    expect(agy.args).toEqual(['--print', '-'])

    const copilot = resolveCommandAndArgs({}, { provider: 'external-cli', model: 'copilot', messages: [] })
    expect(copilot.command).toBe('copilot')
    expect(copilot.args).toEqual([])
  })
})

describe('ExternalCliAdapter', () => {
  it('provides metadata and model information', async () => {
    const adapter = new ExternalCliAdapter({ command: 'claude' })
    expect(adapter.providerInfo('external-cli')).toEqual({ id: 'external-cli', name: 'External CLI' })

    const models = await adapter.listModels('external-cli')
    expect(models.map(m => m.id)).toContain('claude')
    expect(models.map(m => m.id)).toContain('agy')
    expect(models.map(m => m.id)).toContain('codex')
    expect(models.map(m => m.id)).toContain('copilot')

    const resolved = await adapter.resolveModel('external-cli', 'claude')
    expect(resolved.id).toBe('claude')
    expect(resolved.context?.contextWindow).toBe(DEFAULT_CONTEXT_WINDOW)
  })

  it('streams responses from a spawned child process', async () => {
    const adapter = new ExternalCliAdapter({
      command: process.execPath,
      args: ['-e', 'process.stdout.write("Hello from external CLI")'],
    })

    const chunks = []
    for await (const chunk of adapter.stream({
      provider: 'external-cli',
      model: 'test',
      messages: [
        createUserMessage({
          content: [{ type: 'text', text: 'Test prompt' }],
          source: { kind: 'user' },
        }),
      ],
    })) {
      chunks.push(chunk)
    }

    const assembler = new BlockAssembler()
    for (const chunk of chunks) {
      assembler.push(chunk)
    }

    expect(assembler.finish).toEqual({ kind: 'stop' })
    expect(assembler.blocks()).toEqual([{ type: 'text', text: 'Hello from external CLI' }])
  })

  it('separates reasoning when CLI outputs think tags', async () => {
    const adapter = new ExternalCliAdapter({
      command: process.execPath,
      args: ['-e', 'process.stdout.write("<think>Thinking step</think>Final answer")'],
    })

    const chunks = []
    for await (const chunk of adapter.stream({
      provider: 'external-cli',
      model: 'test',
      messages: [
        createUserMessage({
          content: [{ type: 'text', text: 'Test prompt' }],
          source: { kind: 'user' },
        }),
      ],
    })) {
      chunks.push(chunk)
    }

    const assembler = new BlockAssembler()
    for (const chunk of chunks) {
      assembler.push(chunk)
    }

    expect(assembler.finish).toEqual({ kind: 'stop' })
    expect(assembler.blocks()).toEqual([
      { type: 'reasoning', text: 'Thinking step' },
      { type: 'text', text: 'Final answer' },
    ])
  })

  it('passes prompt through stdin to the child process', async () => {
    const adapter = new ExternalCliAdapter({
      command: process.execPath,
      args: ['-e', 'let data = ""; process.stdin.on("data", c => data += c); process.stdin.on("end", () => process.stdout.write("ECHO: " + data.trim()))'],
    })

    const chunks = []
    for await (const chunk of adapter.stream({
      provider: 'external-cli',
      model: 'test',
      messages: [
        createUserMessage({
          content: [{ type: 'text', text: 'Piped through stdin' }],
          source: { kind: 'user' },
        }),
      ],
    })) {
      chunks.push(chunk)
    }

    const assembler = new BlockAssembler()
    for (const chunk of chunks) {
      assembler.push(chunk)
    }

    expect(assembler.blocks()).toEqual([{ type: 'text', text: 'ECHO: Piped through stdin' }])
  })

  it('handles child process failure with error finish chunk', async () => {
    const adapter = new ExternalCliAdapter({
      command: process.execPath,
      args: ['-e', 'process.stderr.write("CLI crashed"); process.exit(1)'],
    })

    const chunks = []
    for await (const chunk of adapter.stream({
      provider: 'external-cli',
      model: 'test',
      messages: [
        createUserMessage({
          content: [{ type: 'text', text: 'Test failure' }],
          source: { kind: 'user' },
        }),
      ],
    })) {
      chunks.push(chunk)
    }

    const finish = chunks.find(c => c.type === 'finish')
    expect(finish).toBeDefined()
    expect(finish?.type === 'finish' && finish.reason.kind).toBe('error')
  })

  it('handles abort signal cleanly', async () => {
    const controller = new AbortController()
    const adapter = new ExternalCliAdapter({
      command: process.execPath,
      args: ['-e', 'setTimeout(() => process.stdout.write("Done"), 5000)'],
    })

    setTimeout(() => controller.abort(), 100)

    const chunks = []
    for await (const chunk of adapter.stream({
      provider: 'external-cli',
      model: 'test',
      messages: [
        createUserMessage({
          content: [{ type: 'text', text: 'Aborted run' }],
          source: { kind: 'user' },
        }),
      ],
      signal: controller.signal,
    })) {
      chunks.push(chunk)
    }

    const finish = chunks.find(c => c.type === 'finish')
    expect(finish).toBeDefined()
    expect(finish?.type === 'finish' && finish.reason.kind).toBe('aborted')
  })
})

describe('Cordis plugin registration', () => {
  it('remains dormant when mounted without command or providers', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmExternalCli, {})

    expect(ctx.llm.listProviders()).toEqual([])
    expect(ctx.llm.listConfigurableProviders()).toEqual([])
  })

  it('registers external-cli in LlmRuntime when top-level command is configured', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmExternalCli, { command: 'agy' })

    const providers = ctx.llm.listProviders().map(p => p.id)
    expect(providers).toContain('cli')
    expect(providers).toContain('external-cli')

    const configurable = ctx.llm.listConfigurableProviders().map(p => p.provider)
    expect(configurable).toEqual(['external-cli'])
  })

  it('updates registrations dynamically on loader/volatile-update', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    let currentProviders: Record<string, LlmExternalCli.ExternalCliProviderProfile> = {}
    const DynamicPlugin = (innerCtx: Context, cfg: LlmExternalCli.Config): void => {
      LlmExternalCli.apply(innerCtx, cfg)
    }
    DynamicPlugin.inject = ['llm']

    await ctx.plugin(
      DynamicPlugin,
      {
        providers: {
          get: () => currentProviders,
        },
      } as unknown as LlmExternalCli.Config,
    )

    expect(ctx.llm.listProviders()).toEqual([])

    currentProviders = {
      agy: {
        command: 'agy',
        displayName: 'Agy CLI',
      },
    }
    ctx.emit('loader/volatile-update', [['providers']])

    expect(ctx.llm.listProviders().map(p => p.id)).toContain('cli')
    expect(ctx.llm.listProviders().map(p => p.id)).toContain('agy')
    expect(ctx.llm.listConfigurableProviders().map(p => p.provider)).toEqual(['agy'])
  })

  it('runs keyless without requiring DEEPSEEK_API_KEY or credentials service', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmExternalCli, {
      command: process.execPath,
      args: ['-e', 'process.stdout.write("Keyless response")'],
    })

    const stream = ctx.llm.stream({
      provider: 'external-cli',
      model: 'agy',
      messages: [
        createUserMessage({
          content: [{ type: 'text', text: 'Hello without API key' }],
          source: { kind: 'user' },
        }),
      ],
    })

    const assembler = new BlockAssembler()
    for await (const chunk of stream) {
      assembler.push(chunk)
    }

    expect(assembler.finish).toEqual({ kind: 'stop' })
    expect(assembler.blocks()).toEqual([{ type: 'text', text: 'Keyless response' }])
  })

  it('supports chat mode with multi-turn messages and tool results', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmExternalCli, {
      command: process.execPath,
      args: ['-e', 'let d=""; process.stdin.on("data", c => d += c); process.stdin.on("end", () => process.stdout.write("Processed chat with length " + d.length))'],
    })

    const stream = ctx.llm.stream({
      provider: 'external-cli',
      model: 'codex',
      system: 'You are Codex.',
      messages: [
        createUserMessage({
          content: [{ type: 'text', text: 'First user message' }],
          source: { kind: 'user' },
        }),
      ],
    })

    const assembler = new BlockAssembler()
    for await (const chunk of stream) {
      assembler.push(chunk)
    }

    expect(assembler.finish).toEqual({ kind: 'stop' })
    expect(assembler.blocks()[0]?.type).toBe('text')
  })

  it('registers configured profiles in directory and resolves per-provider settings', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmExternalCli, {
      providers: {
        agy: {
          command: process.execPath,
          args: ['-e', 'process.stdout.write("Hello from Agy CLI")'],
          displayName: 'Agy Assistant',
        },
      },
    })

    const configurable = ctx.llm.listConfigurableProviders()
    const agyEntry = configurable.find(entry => entry.provider === 'agy')
    expect(agyEntry).toBeDefined()
    expect(agyEntry?.displayName).toBe('Agy Assistant')
    expect(agyEntry?.settingsNs).toBe('llm-external-cli')
    expect(agyEntry?.settingsPath).toEqual(['providers', 'agy'])

    const providers = ctx.llm.listProviders()
    const info = providers.find(p => p.id === 'agy')
    expect(info?.name).toBe('Agy Assistant')
    const cliInfo = providers.find(p => p.id === 'cli')
    expect(cliInfo?.name).toBe('CLI')

    // Models under CLI provider group
    const cliModels = await ctx.llm.listModels('cli')
    expect(cliModels).toEqual([
      { provider: 'cli', id: 'agy', name: 'Agy Assistant' },
    ])

    const stream = ctx.llm.stream({
      provider: 'cli',
      model: 'agy',
      messages: [
        createUserMessage({
          content: [{ type: 'text', text: 'Hi' }],
          source: { kind: 'user' },
        }),
      ],
    })

    const assembler = new BlockAssembler()
    for await (const chunk of stream) {
      assembler.push(chunk)
    }
    expect(assembler.finish).toEqual({ kind: 'stop' })
    expect(assembler.blocks()).toEqual([{ type: 'text', text: 'Hello from Agy CLI' }])
  })
})
