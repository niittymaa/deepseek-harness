import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const binScript = fileURLToPath(new URL('../../../../src/bin.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../../../../tsconfig.json', import.meta.url))

describe('headless external CLI responses', () => {
  it.each([
    { output: 'CLI_RESPONSE_OK', diagnostic: '', exitCode: 0 },
    { output: '', diagnostic: 'Individual quota reached. Resets in 70h14m29s.', exitCode: 1 },
  ])('reports response or diagnostic through the shipped profile: $exitCode', async ({ output, diagnostic, exitCode }) => {
    const script = `process.stdin.resume(); process.stdin.on('end', () => { process.stdout.write(${JSON.stringify(output)}); process.stderr.write(${JSON.stringify(diagnostic)}); })`
    const result = await runLoaderSmoke({
      label: 'external CLI response',
      tempDirPrefix: 'dsh-external-cli-',
      binScript,
      tsconfigPath,
      sourceImport: 'tsx/esm',
      configPath: 'external-cli.yml',
      binArgs: ['--profile', 'headless', '--patch', 'external-cli.yml', '--provider', 'external-cli', '--model', 'fixture', 'Reply hello'],
      expectedExitCode: exitCode,
      prepare: async (cwd) => {
        await writeFile(join(cwd, 'external-cli.yml'), `- id: llm-external-cli\n  config:\n    command: ${JSON.stringify(process.execPath)}\n    args: ${JSON.stringify(['-e', script])}\n`)
      },
    })
    if (exitCode === 0) {
      expect(result.stdout.trim()).toBe(output)
    } else {
      expect(result.stdout.trim()).toBe('')
      expect(result.stderr).toContain('CLI_EMPTY_OUTPUT')
      expect(result.stderr).toContain(diagnostic)
    }
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
