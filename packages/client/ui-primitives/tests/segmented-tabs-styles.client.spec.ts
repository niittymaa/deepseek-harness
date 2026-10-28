import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const controlCss = readFileSync(fileURLToPath(new URL('../src/SegmentedControl.module.css', import.meta.url)), 'utf8')
const tabsCss = readFileSync(fileURLToPath(new URL('../src/SegmentedTabs.module.css', import.meta.url)), 'utf8')

function ruleDeclarations(css: string, selector: string): string {
  const match = new RegExp(`${selector}\\s*\\{([^}]*)\\}`, 'u').exec(css)
  if (match?.[1] === undefined) throw new Error(`Missing CSS rule: ${selector}`)
  return match[1]
}

describe('segmented tab styles', () => {
  it('fits equal control columns inside the available width', () => {
    const control = ruleDeclarations(controlCss, '\\.control')
    for (const declaration of [
      'box-sizing: border-box',
      'display: grid',
      'grid-template-columns: repeat(var(--dsh-segment-count), minmax(0, 1fr))',
      'width: 100%',
      'min-width: 0',
    ]) {
      expect(control).toContain(declaration)
    }
  })

  it.each([
    ['SegmentedControl', controlCss],
    ['SegmentedTabs', tabsCss],
  ])('%s clips labels with an ellipsis', (_name, stylesheet) => {
    expect(ruleDeclarations(stylesheet, '\\.tab')).toContain('min-width: 0')
    const label = ruleDeclarations(stylesheet, '\\.label')
    for (const declaration of [
      'width: 100%',
      'min-width: 0',
      'overflow: hidden',
      'text-overflow: ellipsis',
      'white-space: nowrap',
    ]) {
      expect(label).toContain(declaration)
    }
  })
})
