/**
 * External CLI process execution, prompt formatting, and output normalization.
 *
 * @module @deepseek-ai/dsh-llm-external-cli/process
 */

import { spawn } from 'node:child_process'
import type { ContentBlock, GenerateOptions, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm'
import { LlmError } from '@deepseek-ai/dsh-llm'
import type { ExternalCliOptions } from './config.ts'

/** Default execution timeout in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 120000

/**
 * Format message content blocks into plain text for CLI transmission.
 * @param content - Array of content blocks.
 * @returns Serialized content text.
 */
export function formatContentBlocks(content: readonly ContentBlock[]): string {
  const parts: string[] = []
  for (const block of content) {
    switch (block.type) {
      case 'text':
        parts.push(block.text)
        break
      case 'reasoning':
        parts.push(`<think>\n${block.text}\n</think>`)
        break
      case 'tool-call':
        parts.push(`[Tool Call: ${block.name}(${block.arguments})]`)
        break
      case 'image':
        parts.push(`[Image: ${block.attachment.name}]`)
        break
      case 'file':
        parts.push(`[File: ${block.attachment.name}]`)
        break
      default:
        break
    }
  }
  return parts.join('\n')
}

/**
 * Format request messages and system prompt for CLI stdin input.
 * In completion mode with a single user message, the raw prompt is returned.
 * In chat mode with multiple messages, structured turn labels are included.
 * @param options - Full generate options.
 * @returns Serialized prompt string for the CLI.
 */
export function formatPrompt(options: GenerateOptions): string {
  if (
    options.messages.length === 1
    && options.system === undefined
    && options.messages[0]?.role === 'user'
  ) {
    const singleMsg = options.messages[0]
    const onlyText = singleMsg.content.every(block => block.type === 'text')
    if (onlyText) {
      return singleMsg.content.map(block => block.text).join('\n')
    }
  }

  const sections: string[] = []
  if (options.system !== undefined && options.system.trim().length > 0) {
    sections.push(`[System]\n${options.system.trim()}`)
  }

  for (const message of options.messages) {
    const roleLabel = message.role.charAt(0).toUpperCase() + message.role.slice(1)
    const text = formatContentBlocks(message.content)
    sections.push(`[${roleLabel}]\n${text}`)
  }

  const lastMessage = options.messages[options.messages.length - 1]
  if (lastMessage !== undefined && (lastMessage.role === 'user' || lastMessage.role === 'tool' || lastMessage.role === 'developer')) {
    sections.push('[Assistant]\n')
  }

  return sections.join('\n\n')
}

/**
 * Parse reasoning tags from CLI output if present.
 * @param output - Raw standard output string from CLI.
 * @returns Separated reasoning text and visible response content.
 */
export function parseThinkTags(output: string): { reasoning?: string; content: string } {
  const match = /<think>([\s\S]*?)<\/think>([\s\S]*)/i.exec(output)
  if (match !== null && match[1] !== undefined && match[2] !== undefined) {
    return {
      reasoning: match[1].trim(),
      content: match[2].trim(),
    }
  }
  return { content: output.trim() }
}

/**
 * Resolve the effective executable command and argument list.
 * @param config - Provider configuration options.
 * @param options - Generation options with model identifier.
 * @returns Resolved executable name and arguments array.
 */
export function resolveCommandAndArgs(
  config: ExternalCliOptions,
  options: GenerateOptions,
): { command: string; args: string[] } {
  const profile = config.providers?.[options.provider] ?? config.providers?.[options.model]
  let command = profile?.command ?? config.command
  let args = profile?.args !== undefined
    ? [...profile.args]
    : config.args !== undefined
      ? [...config.args]
      : undefined

  if (command === undefined || command.trim().length === 0) {
    const rawModel = options.model.trim()
    const modelLower = rawModel.toLowerCase()
    const providerLower = options.provider.trim().toLowerCase()
    if (providerLower === 'agy' || providerLower === 'codex' || providerLower === 'claude' || providerLower === 'copilot') {
      command = providerLower
    } else if (modelLower === 'agy' || modelLower === 'codex' || modelLower === 'claude' || modelLower === 'copilot') {
      command = modelLower
    } else {
      command = rawModel || 'claude'
    }
  }

  if (args === undefined) {
    const cmdBase = command.toLowerCase()
    if (cmdBase.includes('agy')) {
      args = ['--print', '-']
    } else if (cmdBase.includes('claude')) {
      args = ['--print']
    } else if (cmdBase.includes('codex')) {
      args = ['exec']
    } else {
      args = []
    }
  }

  return { command, args }
}

/**
 * Stream responses from an external local CLI command.
 * Sends the formatted prompt via stdin and parses stdout as normalized stream chunks.
 * Empty successful output yields CLI_EMPTY_OUTPUT with the standard-error diagnostic.
 * @param config - Provider configuration options.
 * @param options - Full generate options.
 * @returns Async iterable yielding canonical StreamChunks.
 */
export async function* streamExternalCli(
  config: ExternalCliOptions,
  options: GenerateOptions,
): AsyncIterable<StreamChunk> {
  const profile = config.providers?.[options.provider] ?? config.providers?.[options.model]
  const prompt = formatPrompt(options)
  const { command, args } = resolveCommandAndArgs(config, options)
  const shell = profile?.shell ?? config.shell ?? false

  let proc: ReturnType<typeof spawn>
  try {
    proc = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    yield {
      type: 'finish',
      reason: {
        kind: 'error',
        failure: {
          code: 'CLI_SPAWN_FAILED',
          message: `Failed to spawn CLI command "${command}": ${message}`,
        },
      },
    }
    return
  }

  const stdoutChunks: Buffer[] = []
  const stderrChunks: Buffer[] = []

  proc.stdout?.on('data', (chunk: Buffer) => {
    stdoutChunks.push(chunk)
  })

  proc.stderr?.on('data', (chunk: Buffer) => {
    stderrChunks.push(chunk)
  })

  // Prevent unhandled error on stdin if child process terminates early
  proc.stdin?.on('error', () => {})

  try {
    proc.stdin?.write(prompt, 'utf8')
    proc.stdin?.end()
  } catch {
    // Child process closed early
  }

  const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit, rejectExit) => {
    proc.on('close', (code, signal) => {
      resolveExit({ code, signal })
    })
    proc.on('error', (err) => {
      rejectExit(err)
    })
  })

  let timeoutTimer: NodeJS.Timeout | undefined
  const timeoutMs = profile?.timeoutMs ?? config.timeoutMs ?? DEFAULT_TIMEOUT_MS

  const abortListener = (): void => {
    try {
      proc.kill()
    } catch {
      // Ignored
    }
  }

  if (options.signal !== undefined) {
    if (options.signal.aborted) {
      abortListener()
    } else {
      options.signal.addEventListener('abort', abortListener, { once: true })
    }
  }

  try {
    const exitResult = await Promise.race([
      exitPromise,
      new Promise<never>((_, rejectTimeout) => {
        timeoutTimer = setTimeout(() => {
          try {
            proc.kill()
          } catch {
            // Ignored
          }
          rejectTimeout(new LlmError(`CLI command "${command}" timed out after ${timeoutMs}ms`, 'CLI_TIMEOUT'))
        }, timeoutMs)
      }),
    ])

    if (options.signal?.aborted === true) {
      yield {
        type: 'finish',
        reason: {
          kind: 'aborted',
          failure: {
            code: 'ABORTED',
            message: 'CLI execution aborted by signal',
          },
        },
      }
      return
    }

    const stdoutText = Buffer.concat(stdoutChunks).toString('utf8')
    const stderrText = Buffer.concat(stderrChunks).toString('utf8')

    if (exitResult.code !== 0 && exitResult.code !== null) {
      const errDetails = stderrText.trim() || stdoutText.trim() || `Process exited with code ${exitResult.code}`
      yield {
        type: 'finish',
        reason: {
          kind: 'error',
          failure: {
            code: 'CLI_EXECUTION_ERROR',
            message: `CLI command "${command}" failed (code ${exitResult.code}): ${errDetails}`,
          },
        },
      }
      return
    }

    const { reasoning, content } = parseThinkTags(stdoutText)
    if (content.length === 0 && (reasoning === undefined || reasoning.length === 0)) {
      yield {
        type: 'finish',
        reason: {
          kind: 'error',
          failure: {
            code: 'CLI_EMPTY_OUTPUT',
            message: `CLI command "${command}" returned no response.${stderrText.trim().length > 0 ? ` ${stderrText.trim()}` : ' Check the CLI authentication and noninteractive permissions.'}`,
          },
        },
      }
      return
    }
    let blockIndex = 0

    if (reasoning !== undefined && reasoning.length > 0) {
      yield { type: 'block-start', index: blockIndex, blockType: 'reasoning' }
      yield { type: 'reasoning-delta', index: blockIndex, text: reasoning }
      yield { type: 'block-end', index: blockIndex, block: { type: 'reasoning', text: reasoning } }
      blockIndex += 1
    }

    yield { type: 'block-start', index: blockIndex, blockType: 'text' }
    yield { type: 'text-delta', index: blockIndex, text: content }
    yield { type: 'block-end', index: blockIndex, block: { type: 'text', text: content } }

    const inputTokens = Math.max(1, Math.ceil(prompt.length / 4))
    const outputTokens = Math.max(1, Math.ceil(stdoutText.length / 4))
    const usage: TokenUsage = {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    }

    yield { type: 'usage', usage }
    yield { type: 'finish', reason: { kind: 'stop' } }
  } catch (error: unknown) {
    if (options.signal?.aborted === true) {
      yield {
        type: 'finish',
        reason: {
          kind: 'aborted',
          failure: {
            code: 'ABORTED',
            message: 'CLI execution aborted by signal',
          },
        },
      }
      return
    }
    const message = error instanceof Error ? error.message : String(error)
    const code = error instanceof LlmError ? error.failure.code : 'CLI_ERROR'
    yield {
      type: 'finish',
      reason: {
        kind: 'error',
        failure: {
          code,
          message,
        },
      },
    }
  } finally {
    if (timeoutTimer !== undefined) {
      clearTimeout(timeoutTimer)
    }
    if (options.signal !== undefined) {
      options.signal.removeEventListener('abort', abortListener)
    }
  }
}
