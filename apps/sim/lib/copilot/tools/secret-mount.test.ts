/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { FunctionExecute, Read, RunCode } from '@/lib/copilot/generated/tool-catalog-v1'
import {
  extractCodeSecretNames,
  getToolSecretMountNames,
  toolHasSecretMountCapability,
} from '@/lib/copilot/tools/secret-mount'

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

  it('uses the generated capability as the sole tool classifier', () => {
    expect(toolHasSecretMountCapability(FunctionExecute.id)).toBe(true)
    expect(toolHasSecretMountCapability(RunCode.id)).toBe(true)
    expect(toolHasSecretMountCapability(Read.id)).toBe(false)
    expect(getToolSecretMountNames(Read.id, { code: 'return {{SECRET}}' })).toEqual([])
    expect(getToolSecretMountNames(RunCode.id, { code: 'return {{SECRET}}' })).toEqual(['SECRET'])
  })
})
