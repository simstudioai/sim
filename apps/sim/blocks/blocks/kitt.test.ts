/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { KittBlock } from '@/blocks/blocks/kitt'

function mapParams(params: Record<string, unknown>): Record<string, unknown> {
  const mapper = KittBlock.tools.config.params
  if (!mapper) throw new Error('Kitt block is missing tools.config.params')
  return mapper(params)
}

describe('Kitt block tool wiring', () => {
  it('selects both registered operation IDs and rejects unknown operations', () => {
    expect(KittBlock.tools.config.tool({ operation: 'kitt_find_email' })).toBe('kitt_find_email')
    expect(KittBlock.tools.config.tool({ operation: 'kitt_verify_email' })).toBe(
      'kitt_verify_email'
    )
    expect(() => KittBlock.tools.config.tool({ operation: 'unsupported' })).toThrow(
      /Unsupported Kitt operation/
    )
  })

  it('maps finder fields and coerces the strict-name dropdown during execution', () => {
    expect(
      mapParams({
        operation: 'kitt_find_email',
        apiKey: 'test-key',
        fe_fullName: 'Erol Toker',
        fe_domain: 'trykitt.ai',
        fe_linkedinStandardProfileURL: 'https://linkedin.com/in/eroltoker',
        fe_strictNameMatches: 'false',
        fe_customData: 'crm-123',
      })
    ).toEqual({
      apiKey: 'test-key',
      fullName: 'Erol Toker',
      domain: 'trykitt.ai',
      linkedinStandardProfileURL: 'https://linkedin.com/in/eroltoker',
      strictNameMatches: false,
      customData: 'crm-123',
    })
  })

  it('maps verifier fields and coerces the alias dropdown during execution', () => {
    expect(
      mapParams({
        operation: 'kitt_verify_email',
        apiKey: 'test-key',
        ve_email: 'erol@trykitt.ai',
        ve_treatAliasesAsValid: 'true',
        ve_customData: 'crm-456',
      })
    ).toEqual({
      apiKey: 'test-key',
      email: 'erol@trykitt.ai',
      treatAliasesAsValid: true,
      customData: 'crm-456',
    })
  })

  it('hides the required API key field on hosted Sim', () => {
    const apiKey = KittBlock.subBlocks.find((subBlock) => subBlock.id === 'apiKey')
    expect(apiKey).toMatchObject({ required: true, password: true, hideWhenHosted: true })
  })
})
