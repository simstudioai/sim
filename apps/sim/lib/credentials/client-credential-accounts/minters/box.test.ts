/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mintBoxServiceAccountToken } from '@/lib/credentials/client-credential-accounts/minters/box'

const TOKEN_URL = 'https://api.box.com/oauth2/token'
const CURRENT_USER_URL = 'https://api.box.com/2.0/users/me'

const FIELDS = { clientId: 'box-cid', clientSecret: 'box-secret', orgId: '1234567' }

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

function htmlResponse(status: number, body: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    json: async () => {
      throw new SyntaxError('Unexpected token < in JSON')
    },
    text: async () => body,
  } as unknown as Response
}

const mockFetch = vi.fn()

function expectMintCall(): void {
  const [url, init] = mockFetch.mock.calls[0]
  expect(url).toBe(TOKEN_URL)
  expect(init.method).toBe('POST')
  expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
  const body = new URLSearchParams(init.body as string)
  expect(body.get('grant_type')).toBe('client_credentials')
  expect(body.get('client_id')).toBe('box-cid')
  expect(body.get('client_secret')).toBe('box-secret')
  expect(body.get('box_subject_type')).toBe('enterprise')
  expect(body.get('box_subject_id')).toBe('1234567')
}

function expectIdentityCall(): void {
  const [url, init] = mockFetch.mock.calls[1]
  expect(url).toBe(CURRENT_USER_URL)
  expect(init.headers.Authorization).toBe('Bearer box-access')
}

describe('mintBoxServiceAccountToken', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('mints a token and resolves the Service Account identity via users/me', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'box-access', expires_in: 3600 }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          name: 'Sim Automation',
          login: 'AutomationUser_123_abc@boxdevedition.com',
        })
      )

    const result = await mintBoxServiceAccountToken(FIELDS)

    expect(result).toEqual({
      accessToken: 'box-access',
      expiresInSeconds: 3600,
      identity: {
        displayName: 'Sim Automation',
        auditMetadata: {
          boxEnterpriseId: '1234567',
          boxServiceAccountLogin: 'AutomationUser_123_abc@boxdevedition.com',
        },
        storedMetadata: {
          enterpriseId: '1234567',
          serviceAccountLogin: 'AutomationUser_123_abc@boxdevedition.com',
        },
      },
    })
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expectMintCall()
    expectIdentityCall()
  })

  it('still succeeds with a fallback identity when users/me fails', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'box-access', expires_in: 2400 }))
      .mockResolvedValueOnce(jsonResponse(500, { message: 'boom' }))

    const result = await mintBoxServiceAccountToken(FIELDS)

    expect(result.accessToken).toBe('box-access')
    expect(result.expiresInSeconds).toBe(2400)
    expect(result.identity).toEqual({
      displayName: 'Box enterprise 1234567',
      auditMetadata: { boxEnterpriseId: '1234567' },
    })
  })

  it('still succeeds when the identity request itself throws', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'box-access', expires_in: 3600 }))
      .mockRejectedValueOnce(new TypeError('fetch failed'))

    const result = await mintBoxServiceAccountToken(FIELDS)

    expect(result.accessToken).toBe('box-access')
    expect(result.identity?.displayName).toBe('Box enterprise 1234567')
  })

  it('throws invalid_credentials on 400 invalid_client', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(400, {
        error: 'invalid_client',
        error_description: 'The client credentials are not valid',
      })
    )

    await expect(mintBoxServiceAccountToken(FIELDS)).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'invalid_credentials',
      status: 400,
      logDetail: expect.objectContaining({ hint: 'client credentials are not valid' }),
    })
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('throws invalid_credentials with an authorization hint on 400 unauthorized_client', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(400, {
        error: 'unauthorized_client',
        error_description: 'This app is not authorized by the enterprise admin',
      })
    )

    await expect(mintBoxServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'invalid_credentials',
      status: 400,
      logDetail: expect.objectContaining({
        hint: 'app is not authorized by the enterprise admin (Platform Apps Manager)',
      }),
    })
  })

  it('flags a wrong app type on the grant-type variant of unauthorized_client', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(400, {
        error: 'unauthorized_client',
        error_description: 'The grant type is unauthorized for this client_id',
      })
    )

    await expect(mintBoxServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'invalid_credentials',
      logDetail: expect.objectContaining({
        hint: 'app was created as user authentication (OAuth 2.0) instead of Server Authentication',
      }),
    })
  })

  it('throws invalid_credentials on 400 invalid_grant', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(400, {
        error: 'invalid_grant',
        error_description: 'Grant credentials are invalid',
      })
    )

    await expect(mintBoxServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'invalid_credentials',
      status: 400,
      logDetail: expect.objectContaining({
        hint: 'Client ID, Client Secret, and Enterprise ID do not all belong to the same app/enterprise, or the app has not been authorized in the Admin Console',
      }),
    })
  })

  it('skips the identity lookup when skipIdentity is set', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, { access_token: 'box-access', expires_in: 3600 })
    )

    const result = await mintBoxServiceAccountToken(FIELDS, { skipIdentity: true })

    expect(result).toEqual({ accessToken: 'box-access', expiresInSeconds: 3600 })
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('throws provider_unavailable (not invalid_credentials) on a 429 rate limit', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(429, { error: 'rate_limit_exceeded' }))

    await expect(mintBoxServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'provider_unavailable',
      status: 429,
    })
  })

  it('throws provider_unavailable on 503', async () => {
    mockFetch.mockResolvedValueOnce(htmlResponse(503, '<html>unavailable</html>'))

    await expect(mintBoxServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'provider_unavailable',
      status: 503,
    })
  })

  it('throws provider_unavailable on a 200 with a non-JSON body', async () => {
    mockFetch.mockResolvedValueOnce(htmlResponse(200, '<html>proxy page</html>'))

    await expect(mintBoxServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'provider_unavailable',
      status: 502,
    })
  })

  it('throws provider_unavailable when the success body is missing access_token', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { token_type: 'bearer' }))

    await expect(mintBoxServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'provider_unavailable',
      status: 502,
    })
  })

  it('throws provider_unavailable on a network error', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'))

    await expect(mintBoxServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'provider_unavailable',
      status: 502,
    })
  })
})
