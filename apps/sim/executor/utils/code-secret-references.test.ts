/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { extractCodeSecretNames } from '@/executor/utils/code-secret-references'

describe('Copilot code secret declarations', () => {
  it.each(['javascript', 'python'])(
    'matches trimmed and embedded references for %s',
    (language) => {
      expect(
        extractCodeSecretNames(
          'const first = "prefix-{{ API_KEY }}"\nreturn "{{TOKEN}}/{{API_KEY}}"',
          language
        )
      ).toEqual(['API_KEY', 'TOKEN'])
    }
  )

  it('matches only runtime-valid shell identifiers without trimming', () => {
    expect(
      extractCodeSecretNames(
        'echo {{API_KEY}} {{ API_KEY }} {{9INVALID}} {{WITH-DASH}} {{_TOKEN}}',
        'shell'
      )
    ).toEqual(['API_KEY', '_TOKEN'])
  })

  it('ignores direct environment access, shell variables, literals, and malformed references', () => {
    expect(
      extractCodeSecretNames(
        'return environmentVariables.API_KEY + "$TOKEN" + "literal" + "{{}}" + "{{MISSING"',
        'javascript'
      )
    ).toEqual([])
  })
})
