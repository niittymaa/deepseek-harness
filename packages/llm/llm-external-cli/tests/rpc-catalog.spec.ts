/** Native CLI catalog channels, driven through a scripted child process. */
import { ChildProcess, spawn } from 'node:child_process'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExternalCliAdapter } from '../src/adapter.ts'
import { discoverCliModels } from '../src/catalog.ts'
import { discoverRpcModels } from '../src/rpc-catalog.ts'

vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawn: vi.fn(),
}))

afterEach(() => { vi.resetAllMocks() })

/** One scripted CLI process the discovery under test talks to. */
interface FakeCli {
  /** The process handle handed back through the mocked `spawn`. */
  readonly child: ChildProcess
  /** Every message the discovery wrote, parsed. */
  readonly sent: Record<string, unknown>[]
  /** Answer one newline-framed message. */
  send(message: unknown): void
  /** Answer one `Content-Length`-framed message. */
  sendFramed(message: unknown): void
  /** Write raw bytes to the discovery's standard output. */
  raw(text: string): void
  /** Write raw bytes to the discovery's standard error. */
  diagnose(text: string): void
  /** Complete the process. */
  close(code?: number): void
}

/**
 * Start a child process double that reacts to each message the discovery writes.
 * @param respond - called with every inbound message and the double.
 * @returns the handles a test drives the conversation through.
 */
function fakeCli(respond: (message: Record<string, unknown>, cli: FakeCli) => void): FakeCli {
  const child = new ChildProcess()
  const input = new PassThrough()
  const output = new PassThrough()
  const diagnostic = new PassThrough()
  child.stdin = input
  child.stdout = output
  child.stderr = diagnostic
  let inbound = Buffer.alloc(0)
  const sent: Record<string, unknown>[] = []
  const finish = (code: number): void => {
    child.emit('exit', code, null)
    child.emit('close', code, null)
  }
  const cli: FakeCli = {
    child,
    sent,
    send: (message) => { output.write(`${JSON.stringify(message)}\n`) },
    sendFramed: (message) => {
      const json = JSON.stringify(message)
      output.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`)
    },
    raw: (text) => { output.write(text) },
    diagnose: (text) => { diagnostic.write(text) },
    close: finish,
  }
  child.kill = () => { finish(0); return true }
  input.on('data', (chunk: Buffer) => {
    inbound = Buffer.concat([inbound, chunk])
    for (;;) {
      if (inbound.subarray(0, 15).toString('utf8') === 'Content-Length:') {
        const headerEnd = inbound.indexOf('\r\n\r\n')
        if (headerEnd < 0) return
        const length = Number(/^Content-Length: (\d+)$/im.exec(inbound.subarray(0, headerEnd).toString('utf8'))?.[1])
        if (inbound.length < headerEnd + 4 + length) return
        const body = inbound.subarray(headerEnd + 4, headerEnd + 4 + length).toString('utf8')
        inbound = inbound.subarray(headerEnd + 4 + length)
        sent.push(JSON.parse(body) as Record<string, unknown>)
        respond(JSON.parse(body) as Record<string, unknown>, cli)
        continue
      }
      const lineEnd = inbound.indexOf(10)
      if (lineEnd < 0) return
      const line = inbound.subarray(0, lineEnd).toString('utf8')
      inbound = inbound.subarray(lineEnd + 1)
      if (line.trim().length === 0) continue
      const message = JSON.parse(line) as Record<string, unknown>
      sent.push(message)
      respond(message, cli)
    }
  })
  vi.mocked(spawn).mockReturnValue(child)
  return cli
}


describe('Codex app-server catalog', () => {
  it('initializes the channel and reads models with their reasoning levels', async () => {
    const cli = fakeCli((message, cli) => {
      if (message['method'] === 'initialize') cli.send({ id: 0, result: { userAgent: 'codex-cli', platformOs: 'windows' } })
      if (message['method'] === 'model/list') cli.send({ id: 1, result: { data: [
        { id: 'gpt-6', model: 'gpt-6', displayName: 'GPT-6', supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }] },
        { id: 'gpt-5', model: 'gpt-5', displayName: 'GPT-5' },
      ], nextCursor: null } })
    })
    expect(await discoverRpcModels({ command: 'codex' }, 'codex')).toEqual([
      { id: 'gpt-6', name: 'GPT-6', reasoningEfforts: { low: 'low', high: 'high' } },
      { id: 'gpt-5', name: 'GPT-5' },
    ])
    expect(spawn).toHaveBeenCalledWith('codex', ['app-server'], expect.objectContaining({
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false,
    }))
    expect(cli.sent.map(message => message['method'] ?? 'initialized')).toEqual(['initialize', 'initialized', 'model/list'])
  })

  it('follows pagination cursors and keeps each model once', async () => {
    const cli = fakeCli((message, cli) => {
      if (message['method'] === 'initialize') cli.send({ id: 0, result: {} })
      if (message['method'] === 'model/list' && message['params'] !== undefined && (message['params'] as Record<string, unknown>)['cursor'] === undefined) {
        cli.send({ id: 1, result: { data: [{ model: 'a', displayName: 'A' }], nextCursor: 'page-2' } })
      } else if (message['method'] === 'model/list') {
        cli.send({ id: 2, result: { data: [{ model: 'b', displayName: 'B' }, { model: 'a', displayName: 'A again' }], nextCursor: null } })
      }
    })
    expect(await discoverRpcModels({ command: 'codex' }, 'codex')).toEqual([
      { id: 'a', name: 'A' }, { id: 'b', name: 'B' },
    ])
    expect(cli.sent.at(-1)).toEqual({ id: 2, method: 'model/list', params: { includeHidden: false, cursor: 'page-2' } })
  })

  it('ignores a catalog the channel repeats after the operation settled', async () => {
    fakeCli((message, cli) => {
      if (message['method'] === 'initialize') cli.send({ id: 0, result: {} })
      if (message['method'] === 'model/list') {
        cli.send({ id: 1, result: { data: [{ model: 'a', displayName: 'A' }] } })
        cli.send({ id: 1, result: { data: [{ model: 'b', displayName: 'B' }] } })
      }
    })
    expect(await discoverRpcModels({ command: 'codex' }, 'codex')).toEqual([{ id: 'a', name: 'A' }])
  })

  it('ignores notifications and replies to requests it did not send', async () => {
    fakeCli((message, cli) => {
      if (message['method'] === 'initialize') {
        cli.send({ method: 'account/updated', params: { authMode: 'chatgpt' } })
        cli.send({ id: 99, result: { data: [{ model: 'ignored', displayName: 'Ignored' }] } })
        cli.send({ id: 0, result: {} })
      }
      if (message['method'] === 'model/list') cli.send({ id: 1, result: { data: [{ model: 'a', displayName: 'A' }] } })
    })
    expect(await discoverRpcModels({ command: 'codex' }, 'codex')).toEqual([{ id: 'a', name: 'A' }])
  })

  it.each([
    ['a cursor already followed', (cli: FakeCli) => {
      cli.send({ id: 1, result: { data: [], nextCursor: 'same' } })
      cli.send({ id: 2, result: { data: [], nextCursor: 'same' } })
    }, 'pagination'],
    ['a cursor that is not a string', (cli: FakeCli) => { cli.send({ id: 1, result: { data: [], nextCursor: 7 } }) }, 'pagination'],
    ['a rejected request', (cli: FakeCli) => { cli.send({ id: 1, error: { code: -32601, message: 'no such method' } }) }, 'codex rejected catalog discovery'],
  ])('refuses %s', async (_label, reply, diagnostic) => {
    fakeCli((message, cli) => {
      if (message['method'] === 'initialize') cli.send({ id: 0, result: {} })
      else reply(cli)
    })
    await expect(discoverRpcModels({ command: 'codex' }, 'codex')).rejects.toThrow(diagnostic)
  })

  it.each([
    ['no model array', { data: { models: [] } }, 'no model array'],
    ['a model entry that is not an object', { data: ['gpt-6'] }, 'not an object'],
    ['a model without an identifier', { data: [{ displayName: 'Nameless' }] }, 'no identifier'],
    ['a model with an empty identifier', { data: [{ model: '  ', displayName: 'Blank' }] }, 'no identifier'],
    ['a model with an unusable name', { data: [{ model: 'gpt-6', displayName: 7 }] }, 'no usable name'],
    ['a model with an empty name', { data: [{ model: 'gpt-6', displayName: ' ' }] }, 'no usable name'],
    ['reasoning levels that are not a list', { data: [{ model: 'gpt-6', supportedReasoningEfforts: 'high' }] }, 'unreadable reasoning levels'],
    ['a reasoning level that is not an object', { data: [{ model: 'gpt-6', supportedReasoningEfforts: ['high'] }] }, 'not an object'],
    ['a reasoning level without a value', { data: [{ model: 'gpt-6', supportedReasoningEfforts: [{}] }] }, 'empty reasoning level'],
    ['a reasoning level that is not a string', { data: [{ model: 'gpt-6', supportedReasoningEfforts: [{ reasoningEffort: 1 }] }] }, 'empty reasoning level'],
  ])('refuses %s', async (_label, result, diagnostic) => {
    fakeCli((message, cli) => {
      if (message['method'] === 'initialize') cli.send({ id: 0, result: {} })
      if (message['method'] === 'model/list') cli.send({ id: 1, result })
    })
    await expect(discoverRpcModels({ command: 'codex' }, 'codex')).rejects.toThrow(diagnostic)
  })
})

describe('Claude Code initialization catalog', () => {
  it('reads the models its initialization discloses', async () => {
    const cli = fakeCli((message, cli) => {
      expect(message).toMatchObject({ type: 'control_request', request_id: 'dsh-catalog', request: { subtype: 'initialize' } })
      cli.send({ type: 'system', subtype: 'init' })
      cli.send({ type: 'control_response', response: { subtype: 'success', request_id: 'other', response: { models: [] } } })
      cli.send({ type: 'control_response', response: { subtype: 'success', request_id: 'dsh-catalog', response: { models: [
        { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus', supportedEffortLevels: ['low', 'high'] },
        { value: 'sonnet', displayName: 'Sonnet' },
      ] } } })
    })
    expect(await discoverRpcModels({ command: 'claude' }, 'claude')).toEqual([
      { id: 'opus', name: 'Opus', reasoningEfforts: { low: 'low', high: 'high' } },
      { id: 'sonnet', name: 'Sonnet' },
    ])
    expect(spawn).toHaveBeenCalledWith('claude', [
      '--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--no-session-persistence',
    ], expect.objectContaining({ shell: false }))
    expect(cli.sent).toHaveLength(1)
  })

  it('reports a refused initialization', async () => {
    fakeCli((_message, cli) => {
      cli.send({ type: 'control_response', response: { subtype: 'error', request_id: 'dsh-catalog', response: { message: 'unsupported' } } })
    })
    await expect(discoverRpcModels({ command: 'claude' }, 'claude')).rejects.toThrow('Claude Code refused catalog initialization')
  })

  it('refuses initialization metadata without a model list', async () => {
    fakeCli((_message, cli) => {
      cli.send({ type: 'control_response', response: { subtype: 'success', request_id: 'dsh-catalog', response: { commands: [] } } })
    })
    await expect(discoverRpcModels({ command: 'claude' }, 'claude')).rejects.toThrow('no model array')
  })
})

describe('Copilot models channel', () => {
  it('connects with the editor identity the channel requires and reads an empty catalog', async () => {
    const cli = fakeCli((message, cli) => {
      if (message['method'] === 'connect') cli.sendFramed({ jsonrpc: '2.0', id: 0, result: { ok: true, protocolVersion: '1' } })
      if (message['method'] === 'models.list') cli.sendFramed({ jsonrpc: '2.0', id: 1, result: { models: [], imageModels: [] } })
    })
    expect(await discoverRpcModels({ command: 'copilot' }, 'copilot')).toEqual([])
    expect(cli.sent[0]).toEqual({
      jsonrpc: '2.0',
      id: 0,
      method: 'connect',
      params: { clientInfo: { editorName: 'dsh', editorVersion: '0.2.1', extensionName: 'dsh', extensionVersion: '0.2.1' } },
    })
    expect(cli.sent[1]).toEqual({ jsonrpc: '2.0', id: 1, method: 'models.list', params: {} })
  })

  it('reads models framed across chunk boundaries and keeps an unnamed model selectable by identifier', async () => {
    fakeCli((message, cli) => {
      if (message['method'] === 'connect') cli.sendFramed({ id: 0, result: { ok: true } })
      if (message['method'] === 'models.list') {
        const json = JSON.stringify({ id: 1, result: { models: [{ id: 'copilot-fast', name: 'Copilot Fast' }, { id: 'copilot-bare' }] } })
        const frame = `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`
        cli.raw(frame.slice(0, 20))
        cli.raw(frame.slice(20, 30))
        cli.raw(frame.slice(30))
      }
    })
    expect(await discoverRpcModels({ command: 'copilot' }, 'copilot')).toEqual([
      { id: 'copilot-fast', name: 'Copilot Fast' }, { id: 'copilot-bare' },
    ])
  })

  it.each([
    ['a message without a usable length', 'Content-Length: none\r\n\r\n{}', 'Content-Length'],
    ['a message that declares more than the output limit', 'Content-Length: 500\r\n\r\n{}', 'Content-Length'],
  ])('refuses %s', async (_label, frame, diagnostic) => {
    fakeCli((message, cli) => {
      if (message['method'] === 'connect') cli.sendFramed({ id: 0, result: { ok: true } })
      if (message['method'] === 'models.list') cli.raw(frame)
    })
    await expect(discoverRpcModels({ command: 'copilot', discoveryMaxBytes: 200 }, 'copilot')).rejects.toThrow(diagnostic)
  })
})

describe('catalog channel failures', () => {
  it('serves the discovered catalog to the chat selector and to model resolution', async () => {
    fakeCli((message, cli) => {
      if (message['method'] === 'initialize') cli.send({ id: 0, result: {} })
      if (message['method'] === 'model/list') cli.send({ id: 1, result: { data: [
        { model: 'gpt-6', displayName: 'GPT-6', supportedReasoningEfforts: [{ reasoningEffort: 'low' }] },
      ] } })
    })
    const adapter = new ExternalCliAdapter({ providers: { codex: { command: 'codex' } } })
    expect((await adapter.listModels('codex')).map(model => model.id)).toEqual(['codex', 'gpt-6'])
    expect(await adapter.resolveModel('codex', 'gpt-6')).toMatchObject({
      name: 'GPT-6',
      reasoning: { efforts: [{ id: 'low', name: 'low' }] },
    })
    // A settings change may point the route at another executable, so its catalog is read again.
    adapter.updateConfig({ providers: { codex: { command: 'codex' } } })
    expect((await adapter.resolveModel('codex', 'gpt-6')).reasoning).toBeUndefined()
  })

  it('reads a native catalog through the shared discovery entry point', async () => {
    fakeCli((message, cli) => {
      if (message['method'] === 'initialize') cli.send({ id: 0, result: {} })
      if (message['method'] === 'model/list') cli.send({ id: 1, result: { data: [{ model: 'gpt-6', displayName: 'GPT-6' }] } })
    })
    // The executable name selects the protocol, so no explicit cliType is needed.
    expect(await discoverCliModels({ command: 'codex' })).toEqual([{ id: 'gpt-6', name: 'GPT-6' }])
  })

  it('starts the protocol executable when the profile names none', async () => {
    fakeCli((message, cli) => {
      if (message['method'] === 'initialize') cli.send({ id: 0, result: {} })
      if (message['method'] === 'model/list') cli.send({ id: 1, result: { data: [] } })
    })
    expect(await discoverRpcModels({}, 'codex')).toEqual([])
    expect(spawn).toHaveBeenCalledWith('codex', ['app-server'], expect.any(Object))
  })

  it('runs the executable through a shell when the profile asks for one', async () => {
    fakeCli((message, cli) => {
      if (message['method'] === 'initialize') cli.send({ id: 0, result: {} })
      if (message['method'] === 'model/list') cli.send({ id: 1, result: { data: [] } })
    })
    await discoverRpcModels({ command: 'codex-wrapper', shell: true }, 'codex')
    expect(spawn).toHaveBeenCalledWith('codex-wrapper', ['app-server'], expect.objectContaining({ shell: true }))
  })

  it('ignores blank lines between messages', async () => {
    fakeCli((message, cli) => {
      if (message['method'] === 'initialize') cli.send({ id: 0, result: {} })
      if (message['method'] === 'model/list') {
        cli.raw('\n')
        cli.send({ id: 1, result: { data: [{ model: 'a', displayName: 'A' }] } })
      }
    })
    expect(await discoverRpcModels({ command: 'codex' }, 'codex')).toEqual([{ id: 'a', name: 'A' }])
  })

  it('refuses malformed catalog JSON', async () => {
    fakeCli((message, cli) => {
      if (message['method'] === 'initialize') cli.send({ id: 0, result: {} })
      if (message['method'] === 'model/list') cli.raw('not json\n')
    })
    await expect(discoverRpcModels({ command: 'codex' }, 'codex')).rejects.toThrow('invalid catalog JSON')
  })

  it('reports a malformed message that arrives unsolicited', async () => {
    const cli = fakeCli(() => {})
    const pending = discoverRpcModels({ command: 'codex' }, 'codex')
    cli.raw('not json\n')
    await expect(pending).rejects.toThrow('invalid catalog JSON')
  })

  it('reports an executable that cannot start', async () => {
    const cli = fakeCli(() => {})
    const pending = discoverRpcModels({ command: 'missing-cli' }, 'codex')
    cli.child.emit('error', new Error('ENOENT'))
    await expect(pending).rejects.toThrow('Could not start the CLI catalog service')
  })

  it('reports a channel that exits before answering', async () => {
    const cli = fakeCli(() => {})
    const pending = discoverRpcModels({ command: 'codex' }, 'codex')
    cli.close(1)
    await expect(pending).rejects.toThrow('exited before returning models')
  })

  it('bounds the bytes the channel may emit', async () => {
    const cli = fakeCli(() => {})
    const pending = discoverRpcModels({ command: 'codex', discoveryMaxBytes: 16 }, 'codex')
    cli.raw('x'.repeat(64))
    await expect(pending).rejects.toThrow('exceeded the configured limit')
  })

  it('counts standard-error bytes against the same limit', async () => {
    const cli = fakeCli(() => {})
    const pending = discoverRpcModels({ command: 'codex', discoveryMaxBytes: 16 }, 'codex')
    cli.diagnose('authentication failed for the configured account')
    await expect(pending).rejects.toThrow('exceeded the configured limit')
  })

  it('stops a channel that does not answer in time', async () => {
    vi.useFakeTimers()
    try {
      fakeCli(() => {})
      const pending = discoverRpcModels({ command: 'codex', timeoutMs: 50 }, 'codex')
      const observed = expect(pending).rejects.toThrow('timed out')
      await vi.advanceTimersByTimeAsync(50)
      await observed
    } finally {
      vi.useRealTimers()
    }
  })

  it('refuses to start for a caller that already cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(discoverRpcModels({ command: 'codex' }, 'codex', controller.signal)).rejects.toThrow('cancelled')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('cancels a channel in flight', async () => {
    const controller = new AbortController()
    fakeCli(() => {})
    const pending = discoverRpcModels({ command: 'codex' }, 'codex', controller.signal)
    controller.abort()
    await expect(pending).rejects.toThrow('cancelled')
  })

  it('stops each channel once a catalog has arrived', async () => {
    const cli = fakeCli((message, cli) => {
      if (message['method'] === 'initialize') cli.send({ id: 0, result: {} })
      if (message['method'] === 'model/list') cli.send({ id: 1, result: { data: [] } })
    })
    const killed = vi.spyOn(cli.child, 'kill')
    await discoverRpcModels({ command: 'codex' }, 'codex')
    expect(killed).toHaveBeenCalled()
  })

  it('returns without waiting for an exit a channel never confirms', async () => {
    vi.useFakeTimers()
    try {
      const cli = fakeCli((message, cli) => {
        if (message['method'] === 'initialize') cli.send({ id: 0, result: {} })
        if (message['method'] === 'model/list') cli.send({ id: 1, result: { data: [{ model: 'a', displayName: 'A' }] } })
      })
      cli.child.kill = () => false
      const pending = discoverRpcModels({ command: 'codex' }, 'codex')
      await vi.advanceTimersByTimeAsync(2000)
      await expect(pending).resolves.toEqual([{ id: 'a', name: 'A' }])
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects a message that is not a JSON object', async () => {
    fakeCli((message, cli) => {
      if (message['method'] === 'initialize') cli.send({ id: 0, result: {} })
      if (message['method'] === 'model/list') cli.raw('[]\n')
    })
    await expect(discoverRpcModels({ command: 'codex' }, 'codex')).rejects.toThrow('not an object')
  })
})
