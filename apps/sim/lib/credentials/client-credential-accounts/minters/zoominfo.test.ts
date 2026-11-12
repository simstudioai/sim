import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

import { mintZoomInfoServiceAccountToken } from '@/lib/credentials/client-credential-accounts/minters/zoominfo'

const { mockSecureFetchWithValidation } = inputValidationMockFns
const FIELDS = { clientId: 'zi-client', clientSecret: 'zi-secret', orgId: '' }

describe('ZoomInfo client credentials exchange', () => {
  beforeEach(() => {
    mockSecureFetchWithValidation.mockReset()
  })

  it('mints at the documented token endpoint with Basic auth, refusing redirects, and calls nothing else', async () => {
    mockSecureFetchWithValidation.mockResolvedValue(
      Response.json({ access_token: 'zi-access', expires_in: 1000, scope: 'api:data:company' })
    )

    const result = await mintZoomInfoServiceAccountToken(FIELDS)

    expect(mockSecureFetchWithValidation).toHaveBeenCalledTimes(1)
    const [url, options] = mockSecureFetchWithValidation.mock.calls[0]
    expect(url).toBe('https://api.zoominfo.com/gtm/oauth/v1/token')
    expect(options).toMatchObject({ method: 'POST', maxRedirects: 0 })
    expect(options.headers.Authorization).toBe(
      `Basic ${Buffer.from('zi-client:zi-secret').toString('base64')}`
    )
    expect(Object.fromEntries(new URLSearchParams(options.body))).toEqual({
      grant_type: 'client_credentials',
    })
    expect(result).toMatchObject({ accessToken: 'zi-access', expiresInSeconds: 1000 })
    expect(result.identity?.storedMetadata).toMatchObject({ grantedScopes: 'api:data:company' })
    expect(JSON.stringify(result.identity)).not.toContain('zi-secret')
    expect(JSON.stringify(result.identity)).not.toContain('zi-access')
  })

  it.each([
    ['clientId', 'client:with-colon'],
    ['clientId', 'client\r\nX-Injected: 1'],
    ['clientSecret', ''],
  ] as const)('refuses an unusable %s before any request', async (field, value) => {
    await expect(
      mintZoomInfoServiceAccountToken({ ...FIELDS, [field]: value })
    ).rejects.toMatchObject({ code: 'invalid_credentials' })
    expect(mockSecureFetchWithValidation).not.toHaveBeenCalled()
  })

  it.each([
    [400, 'invalid_credentials'],
    [401, 'invalid_credentials'],
    [403, 'invalid_credentials'],
    [429, 'provider_unavailable'],
    [503, 'provider_unavailable'],
  ])('maps an HTTP %i token response to %s', async (status, code) => {
    mockSecureFetchWithValidation.mockResolvedValue(
      Response.json({ error: 'invalid_client' }, { status })
    )

    await expect(mintZoomInfoServiceAccountToken(FIELDS)).rejects.toMatchObject({ code })
  })

  it("carries the token endpoint's Retry-After on a throttled answer", async () => {
    mockSecureFetchWithValidation.mockResolvedValue(
      Response.json({ error: 'busy' }, { status: 429, headers: { 'Retry-After': '7' } })
    )

    await expect(mintZoomInfoServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'provider_unavailable',
      retryAfterMs: 7_000,
    })
  })

  it('treats a refused redirect or network failure as a provider failure', async () => {
    mockSecureFetchWithValidation.mockRejectedValue(new Error('Too many redirects (max: 0)'))

    await expect(mintZoomInfoServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'provider_unavailable',
    })
  })

  it('refuses a token response without an access token', async () => {
    mockSecureFetchWithValidation.mockResolvedValue(Response.json({ expires_in: 1000 }))

    await expect(mintZoomInfoServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'provider_unavailable',
    })
  })
})
