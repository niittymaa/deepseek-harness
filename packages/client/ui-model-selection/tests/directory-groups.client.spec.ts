import { describe, expect, it } from 'vitest'
import { selectableGroups } from '../src/client/directory.ts'
import type { ModelProviderGroup } from '@deepseek-ai/dsh-api-session-controller/types'

const group = (id: string, models: string[]): ModelProviderGroup => ({
  id,
  name: id,
  models: models.map(model => ({ id: model, name: model })),
})

describe('selectableGroups', () => {
  it('drops a group whose every entry names another provider', () => {
    const groups = [group('deepseek-account', ['deepseek-flash']), group('agy', ['gemini-4-argon-high', 'agy']), group('cli', ['agy', 'codex']), group('codex', ['gpt-6.1-sol', 'codex'])]
    expect(selectableGroups(groups).map(entry => entry.id)).toEqual(['deepseek-account', 'agy', 'codex'])
  })

  it('keeps a route that offers only its own CLI default entry', () => {
    expect(selectableGroups([group('copilot', ['copilot'])]).map(entry => entry.id)).toEqual(['copilot'])
  })

  it('keeps a route whose models share an identifier with another provider', () => {
    const groups = [group('claude', ['default', 'claude']), group('codex', ['default', 'codex'])]
    expect(selectableGroups(groups).map(entry => entry.id)).toEqual(['claude', 'codex'])
  })

  it('keeps the alias group holding the saved selection', () => {
    const groups = [group('agy', ['gemini-4-argon-high', 'agy']), group('cli', ['agy', 'codex']), group('codex', ['gpt-6.1-sol', 'codex'])]
    expect(selectableGroups(groups, 'cli').map(entry => entry.id)).toEqual(['agy', 'cli', 'codex'])
  })
})
