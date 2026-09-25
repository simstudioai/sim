import { describe, expect, it } from 'vitest'
import { HarmonicBlock } from '@/blocks/blocks/harmonic'

describe('HarmonicBlock', () => {
  const buildParams = HarmonicBlock.tools.config!.params!
  const resolve = (inputs: Record<string, unknown>) => ({ ...inputs, ...buildParams(inputs) })

  it('forwards only the Scout query and reusable credential for natural-language search', () => {
    const params = resolve({
      operation: 'harmonic_search_people_scout',
      oauthCredential: 'credential-id',
      apiKey: 'retired-inline-key',
      query: 'Find FDEs in enterprise software',
      savedSearchId: 'stale-search',
      savedSearchSelector: 'stale-selector-value',
      savedSearchIdManual: 'stale-manual-value',
      personIds: '[22]',
      personUrns: '["urn:harmonic:person:22"]',
      size: '50',
      cursor: 'stale-cursor',
    })

    expect(params).toMatchObject({
      oauthCredential: 'credential-id',
      query: 'Find FDEs in enterprise software',
    })
    expect(params.apiKey).toBeUndefined()
    expect(params.operation).toBeUndefined()
    expect(params.savedSearchId).toBeUndefined()
    expect(params.savedSearchSelector).toBeUndefined()
    expect(params.savedSearchIdManual).toBeUndefined()
    expect(params.personIds).toBeUndefined()
    expect(params.personUrns).toBeUndefined()
    expect(params.size).toBeUndefined()
    expect(params.cursor).toBeUndefined()
  })

  it('passes batch identifier strings to the secret-safe tool boundary and preserves arrays', () => {
    const parsed = resolve({
      operation: 'harmonic_batch_get_people',
      oauthCredential: 'credential-id',
      personIds: '[22,1690]',
      personUrns: '["urn:harmonic:person:44"]',
    })
    expect(parsed.personIds).toBe('[22,1690]')
    expect(parsed.personUrns).toBe('["urn:harmonic:person:44"]')

    const direct = resolve({
      operation: 'harmonic_batch_get_people',
      oauthCredential: 'credential-id',
      personIds: [22],
      personUrns: ['urn:harmonic:person:44'],
    })
    expect(direct.personIds).toEqual([22])
    expect(direct.personUrns).toEqual(['urn:harmonic:person:44'])
  })

  it('does not parse malformed batch JSON before the secret-safe tool boundary', () => {
    expect(
      resolve({
        operation: 'harmonic_batch_get_people',
        oauthCredential: 'credential-id',
        personUrns: '[not-json]',
      }).personUrns
    ).toBe('[not-json]')
  })
})
