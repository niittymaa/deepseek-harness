/** Windows launcher cleanup isolation exercised without stopping real applications. */
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

describe.skipIf(process.platform !== 'win32')('launcher desktop process ownership', () => {
  it('preserves unrelated apps and refuses stale process identities', () => {
    const output = execFileSync('powershell.exe', [
      '-NoProfile', '-File', fileURLToPath(new URL('./tests/launcher-processes.tests.ps1', import.meta.url)),
    ], { encoding: 'utf8', timeout: 30000 })
    expect(output).toContain('PASS: checkout ownership')
  })
})
