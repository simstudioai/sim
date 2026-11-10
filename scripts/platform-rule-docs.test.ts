import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'
import { headingAnchor, PLATFORM_CONTRACT, ruleDocumentation } from './platform-rule-docs'

const ROOT = path.resolve(import.meta.dirname, '..')

/** Every rule id `check:platform-design` can report, read from its `report` calls. */
function reportedRules(): string[] {
  const source = readFileSync(path.join(ROOT, 'scripts/check-platform-design.ts'), 'utf8')
  const ids = [...source.matchAll(/\breport(?:FileOnce)?\(\s*'([a-z]+(?:-[a-z]+)+)'/g)]
  return [...new Set(ids.map((match) => match[1] as string))].sort()
}

it('points every rule check:platform-design reports at a heading that exists', () => {
  const contract = readFileSync(path.join(ROOT, PLATFORM_CONTRACT), 'utf8')
  const anchors = new Set(
    contract
      .split('\n')
      .filter((line) => /^#{1,6}\s/.test(line))
      .map((line) => headingAnchor(line.replace(/^#+\s*/, '')))
  )
  const rules = reportedRules()
  expect(rules.length).toBeGreaterThan(30)
  for (const rule of rules) {
    const documented = ruleDocumentation(ROOT, rule)
    expect.soft(documented, rule).toMatch(/#[\w-]+$/)
    if (documented.startsWith(`${PLATFORM_CONTRACT}#`))
      expect
        .soft(anchors.has(documented.split('#')[1] as string), `${rule}: ${documented}`)
        .toBe(true)
  }
})
