/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { getPipedriveAuthHeaders } from '@/tools/pipedrive/utils'

describe('getPipedriveAuthHeaders', () => {
  it('returns Bearer headers by default (OAuth credentials)', () => {
    expect(getPipedriveAuthHeaders({ accessToken: 'oauth-token' })).toEqual({
      Authorization: 'Bearer oauth-token',
      Accept: 'application/json',
    })
  })

  it('returns x-api-token headers for API-token service accounts', () => {
    expect(getPipedriveAuthHeaders({ accessToken: 'api-token', authStyle: 'x-api-token' })).toEqual(
      {
        'x-api-token': 'api-token',
        Accept: 'application/json',
      }
    )
  })

  it('ignores unknown auth styles and falls back to Bearer', () => {
    const params = { accessToken: 'tok', authStyle: 'bearer' } as unknown as Parameters<
      typeof getPipedriveAuthHeaders
    >[0]
    expect(getPipedriveAuthHeaders(params)).toEqual({
      Authorization: 'Bearer tok',
      Accept: 'application/json',
    })
  })

  it('throws when the access token is missing', () => {
    expect(() => getPipedriveAuthHeaders({ accessToken: '' })).toThrow('Access token is required')
  })
})
