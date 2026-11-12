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

import { mintInfisicalUniversalAuthToken } from '@/lib/credentials/token-service-accounts/grants/infisical'

const FIELDS = {
  clientId: 'identity-client',
  clientSecret: 'identity-secret',
  domain: 'https://Secrets.Example.com/',
}

const secureFetch = inputValidationMockFns.mockSecureFetchWithValidation

describe('Infisical Universal Auth login', () => {
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

  it('logs in with a JSON body at the instance through the configured-endpoint guard', async () => {
    secureFetch.mockResolvedValueOnce(
      jsonResponse({
        accessToken: 'machine-token',
        expiresIn: 7200,
        accessTokenMaxTTL: 2_592_000,
        tokenType: 'Bearer',
      })
    )

    const minted = await mintInfisicalUniversalAuthToken(FIELDS)

    expect(minted.accessToken).toBe('machine-token')
    expect(minted.expiresInSeconds).toBeGreaterThan(7100)
    expect(minted.expiresInSeconds).toBeLessThanOrEqual(7200)
    const [url, options] = secureFetch.mock.calls[0]
    expect(url).toBe('https://secrets.example.com/api/v1/auth/universal-auth/login')
    expect(options).toMatchObject({
      profile: 'configuredEndpoint',
      method: 'POST',
      maxRedirects: 0,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    })
    expect(JSON.parse(options.body)).toEqual({
      clientId: 'identity-client',
      clientSecret: 'identity-secret',
    })
    expect(coordinated).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'infisical',
        application: ['https://secrets.example.com', 'identity-client'],
        clientSecret: 'identity-secret',
      })
    )
  })

  it('serves a long-lived token for at most a day so an early revocation is picked up', async () => {
    secureFetch.mockResolvedValueOnce(
      jsonResponse({ accessToken: 'long-token', expiresIn: 2_592_000, tokenType: 'Bearer' })
    )

    const minted = await mintInfisicalUniversalAuthToken(FIELDS)

    expect(minted.expiresInSeconds).toBeLessThanOrEqual(86_400)
    expect(minted.expiresInSeconds).toBeGreaterThan(86_000)
  })

  it('serves the token of an identity whose access token TTL is 0 (no expiry) for a day', async () => {
    secureFetch.mockResolvedValueOnce(
      jsonResponse({ accessToken: 'unbounded-token', expiresIn: 0, tokenType: 'Bearer' })
    )

    const minted = await mintInfisicalUniversalAuthToken(FIELDS)

    expect(minted.accessToken).toBe('unbounded-token')
    expect(minted.expiresInSeconds).toBeLessThanOrEqual(86_400)
    expect(minted.expiresInSeconds).toBeGreaterThan(86_000)
  })

  it.each([
    ['a missing access token', { expiresIn: 7200 }],
    ['a blank access token', { accessToken: '  ', expiresIn: 7200 }],
    ['a negative lifetime', { accessToken: 'token', expiresIn: -1 }],
    ['a fractional lifetime', { accessToken: 'token', expiresIn: 1.5 }],
    ['a non-object body', ['token']],
  ])('treats %s as the provider failing, not the credentials', async (_case, body) => {
    secureFetch.mockResolvedValueOnce(jsonResponse(body))

    await expect(mintInfisicalUniversalAuthToken(FIELDS)).rejects.toMatchObject({
      code: 'provider_unavailable',
    })
  })

  it.each([
    [401, 'invalid_credentials'],
    [400, 'invalid_credentials'],
    [403, 'invalid_credentials'],
    [404, 'invalid_credentials'],
    [429, 'provider_unavailable'],
    [500, 'provider_unavailable'],
  ])('classifies a %s login refusal as %s', async (status, code) => {
    secureFetch.mockResolvedValueOnce(
      jsonResponse({ statusCode: status, message: 'nope', error: 'Unauthorized' }, status)
    )

    await expect(mintInfisicalUniversalAuthToken(FIELDS)).rejects.toMatchObject({ code, status })
  })

  it('never logs in to an instance URL carrying credentials or another scheme', async () => {
    for (const domain of ['https://user:pass@secrets.example.com', 'ftp://secrets.example.com']) {
      await expect(mintInfisicalUniversalAuthToken({ ...FIELDS, domain })).rejects.toMatchObject({
        code: 'site_not_found',
      })
    }
    expect(secureFetch).not.toHaveBeenCalled()
  })

  it('requires both the client ID and secret before contacting Infisical', async () => {
    await expect(
      mintInfisicalUniversalAuthToken({ ...FIELDS, clientSecret: '' })
    ).rejects.toMatchObject({ code: 'invalid_credentials' })
    await expect(
      mintInfisicalUniversalAuthToken({ ...FIELDS, clientId: '  ' })
    ).rejects.toMatchObject({ code: 'invalid_credentials' })
    expect(secureFetch).not.toHaveBeenCalled()
  })
})
