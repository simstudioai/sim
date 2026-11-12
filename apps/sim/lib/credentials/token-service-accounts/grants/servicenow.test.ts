import { jsonResponse } from '@sim/testing/helpers/http'
import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { coordinated } = vi.hoisted(() => ({ coordinated: vi.fn() }))

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)
vi.mock('@/lib/credentials/coordinated-client-token', () => ({
  resolveCoordinatedClientToken: coordinated,
}))

import { mintServiceNowClientCredentialsToken } from '@/lib/credentials/token-service-accounts/grants/servicenow'

const FIELDS = {
  clientId: 'sn-client',
  clientSecret: 'sn-secret',
  domain: 'Acme.service-now.com/now/nav/ui',
}

const secureFetch = inputValidationMockFns.mockSecureFetchWithValidation

describe('ServiceNow client credentials grant', () => {
  beforeEach(() => {
    secureFetch.mockReset()
    coordinated.mockReset()
    coordinated.mockImplementation(
      async (input: {
        exchange: (signal?: AbortSignal) => Promise<{ accessToken: string; expiresAt: Date }>
        signal?: AbortSignal
      }) => {
        const exchanged = await input.exchange(input.signal)
        return {
          accessToken: exchanged.accessToken,
          expiresInSeconds: Math.floor((exchanged.expiresAt.getTime() - Date.now()) / 1000),
        }
      }
    )
  })

  it('posts the grant as a form to the instance oauth_token.do through the egress guard', async () => {
    secureFetch.mockResolvedValueOnce(
      jsonResponse({ access_token: 'sn-token', expires_in: 1799, token_type: 'Bearer' })
    )

    const minted = await mintServiceNowClientCredentialsToken(FIELDS)

    expect(minted.accessToken).toBe('sn-token')
    expect(minted.expiresInSeconds).toBeGreaterThan(1700)
    const [url, options] = secureFetch.mock.calls[0]
    expect(url).toBe('https://acme.service-now.com/oauth_token.do')
    expect(options).toMatchObject({
      profile: 'configuredEndpoint',
      method: 'POST',
      maxRedirects: 0,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    expect([...new URLSearchParams(options.body)]).toEqual([
      ['grant_type', 'client_credentials'],
      ['client_id', 'sn-client'],
      ['client_secret', 'sn-secret'],
    ])
    expect(coordinated).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'servicenow',
        application: ['https://acme.service-now.com', 'sn-client'],
        clientSecret: 'sn-secret',
      })
    )
  })

  it('never sends the secret to a plain-http instance or one carrying credentials', async () => {
    for (const domain of ['http://acme.service-now.com', 'https://me:pw@acme.service-now.com']) {
      await expect(
        mintServiceNowClientCredentialsToken({ ...FIELDS, domain })
      ).rejects.toMatchObject({ code: 'site_not_found' })
    }
    expect(secureFetch).not.toHaveBeenCalled()
  })

  it('requires the client ID and secret before contacting the instance', async () => {
    await expect(
      mintServiceNowClientCredentialsToken({ ...FIELDS, clientSecret: '' })
    ).rejects.toMatchObject({ code: 'invalid_credentials' })
    expect(secureFetch).not.toHaveBeenCalled()
  })
})
