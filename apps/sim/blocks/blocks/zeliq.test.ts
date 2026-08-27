/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { ZeliqBlock } from '@/blocks/blocks/zeliq'

function mapParams(params: Record<string, unknown>): Record<string, unknown> {
  const mapper = ZeliqBlock.tools.config.params
  if (!mapper) throw new Error('Zeliq block is missing tools.config.params')
  return mapper(params)
}

describe('Zeliq block tool wiring', () => {
  it('maps only the active LinkedIn email lookup fields', () => {
    expect(
      mapParams({
        operation: 'zeliq_enrich_email',
        emailLookupMethod: 'linkedin',
        apiKey: 'test-key',
        callbackUrl: 'https://example.com/callback',
        emailLinkedInUrl: 'https://linkedin.com/in/active',
        emailFirstName: 'Stale',
        emailLastName: 'Person',
        emailDomain: 'stale.example',
        phoneLookupMethod: 'email',
        phoneEmail: 'stale@example.com',
      })
    ).toEqual({
      apiKey: 'test-key',
      callbackUrl: 'https://example.com/callback',
      linkedinUrl: 'https://linkedin.com/in/active',
    })
  })

  it('maps only the active person-details email lookup fields', () => {
    expect(
      mapParams({
        operation: 'zeliq_enrich_email',
        emailLookupMethod: 'person_details',
        apiKey: 'test-key',
        callbackUrl: 'https://example.com/callback',
        emailLinkedInUrl: 'https://linkedin.com/in/stale',
        emailFirstName: 'Jane',
        emailLastName: 'Doe',
        emailCompany: 'Example Inc',
        emailDomain: 'example.com',
        phoneLinkedInUrl: 'https://linkedin.com/in/stale-phone',
      })
    ).toEqual({
      apiKey: 'test-key',
      callbackUrl: 'https://example.com/callback',
      firstName: 'Jane',
      lastName: 'Doe',
      company: 'Example Inc',
      domain: 'example.com',
    })
  })

  it('maps only the active phone lookup fields', () => {
    expect(
      mapParams({
        operation: 'zeliq_enrich_phone',
        phoneLookupMethod: 'email',
        apiKey: 'test-key',
        callbackUrl: 'https://example.com/callback',
        phoneEmail: 'active@example.com',
        phoneLinkedInUrl: 'https://linkedin.com/in/stale-phone',
        emailLookupMethod: 'linkedin',
        emailLinkedInUrl: 'https://linkedin.com/in/stale-email',
      })
    ).toEqual({
      apiKey: 'test-key',
      callbackUrl: 'https://example.com/callback',
      email: 'active@example.com',
    })
  })

  it('fails fast for unknown operations and lookup methods', () => {
    expect(() => mapParams({ operation: 'unsupported' })).toThrow(/Unsupported Zeliq operation/)
    expect(() =>
      mapParams({ operation: 'zeliq_enrich_email', emailLookupMethod: 'unsupported' })
    ).toThrow(/Unsupported Zeliq email lookup method/)
    expect(() =>
      mapParams({ operation: 'zeliq_enrich_phone', phoneLookupMethod: 'unsupported' })
    ).toThrow(/Unsupported Zeliq phone lookup method/)
  })
})
