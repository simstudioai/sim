/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetCanonicalScopesForProvider } = vi.hoisted(() => ({
  mockGetCanonicalScopesForProvider: vi.fn(),
}))

vi.mock('@/lib/oauth/utils', () => ({
  getCanonicalScopesForProvider: mockGetCanonicalScopesForProvider,
}))

import { mintZohoDeskServiceAccountToken } from '@/lib/credentials/client-credential-accounts/minters/zoho-desk'

const TOKEN_URL = 'https://accounts.zoho.com/oauth/v2/token'

const SCOPES = ['Desk.tickets.READ', 'Desk.contacts.READ', 'aaaserver.profile.READ']

const FIELDS = { clientId: 'zoho-cid', clientSecret: 'zoho-secret', orgId: '600123456' }

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

function mintBody(): URLSearchParams {
  const [url, init] = mockFetch.mock.calls[0]
  expect(url).toBe(TOKEN_URL)
  expect(init.method).toBe('POST')
  expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
  return new URLSearchParams(init.body as string)
}

describe('mintZohoDeskServiceAccountToken', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
    mockGetCanonicalScopesForProvider.mockReturnValue(SCOPES)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the minted token, derived Desk base, scopes, and identity on success', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, {
        access_token: 'zoho-access',
        api_domain: 'https://www.zohoapis.com',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'Desk.tickets.READ,Desk.contacts.READ',
      })
    )

    const result = await mintZohoDeskServiceAccountToken(FIELDS)

    expect(result).toEqual({
      accessToken: 'zoho-access',
      expiresInSeconds: 3600,
      apiDomain: 'https://desk.zoho.com',
      grantedScopes: ['Desk.tickets.READ', 'Desk.contacts.READ'],
      identity: {
        displayName: 'Zoho Desk org 600123456',
        auditMetadata: {
          zohoDeskSoid: 'ZohoDesk.600123456',
          zohoDeskClientId: 'zoho-cid',
        },
        storedMetadata: {
          soid: 'ZohoDesk.600123456',
          apiDomain: 'https://desk.zoho.com',
          grantedScopes: 'Desk.tickets.READ Desk.contacts.READ',
        },
      },
    })
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('sends client_credentials with a COMMA-separated scope list and a ZohoDesk-prefixed soid', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { access_token: 'zoho-access' }))

    await mintZohoDeskServiceAccountToken(FIELDS)

    const body = mintBody()
    expect(body.get('grant_type')).toBe('client_credentials')
    expect(body.get('client_id')).toBe('zoho-cid')
    expect(body.get('client_secret')).toBe('zoho-secret')
    expect(body.get('scope')).toBe(SCOPES.join(','))
    expect(body.get('scope')).not.toContain(' ')
    expect(body.get('soid')).toBe('ZohoDesk.600123456')
    expect(mockGetCanonicalScopesForProvider).toHaveBeenCalledWith('zoho-desk')
  })

  it('passes an already-prefixed soid through unchanged', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { access_token: 'zoho-access' }))

    await mintZohoDeskServiceAccountToken({ ...FIELDS, orgId: ' ZohoCRM.600123456 ' })

    expect(mintBody().get('soid')).toBe('ZohoCRM.600123456')
  })

  it('derives the data-center Desk base from a non-US api_domain', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, { access_token: 'zoho-access', api_domain: 'https://www.zohoapis.eu' })
    )

    const result = await mintZohoDeskServiceAccountToken(FIELDS, { skipIdentity: true })

    expect(result).toEqual({
      accessToken: 'zoho-access',
      expiresInSeconds: 3600,
      apiDomain: 'https://desk.zoho.eu',
      grantedScopes: undefined,
    })
  })

  it('falls back to the US Desk base when api_domain is absent or not a Zoho host', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, { access_token: 'a', api_domain: 'https://zoho.attacker.com' })
    )

    const result = await mintZohoDeskServiceAccountToken(FIELDS, { skipIdentity: true })

    expect(result.apiDomain).toBe('https://desk.zoho.com')
  })

  it('rejects a non-numeric organization ID before any network call', async () => {
    await expect(
      mintZohoDeskServiceAccountToken({ ...FIELDS, orgId: 'my-org' })
    ).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'invalid_credentials',
      status: 400,
      logDetail: expect.objectContaining({ step: 'soid_validation' }),
    })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('throws invalid_credentials on an HTTP 200 body carrying an error field', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { error: 'invalid_client' }))

    await expect(mintZohoDeskServiceAccountToken(FIELDS)).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'invalid_credentials',
      status: 200,
      logDetail: expect.objectContaining({
        zohoError: 'invalid_client',
        soid: 'ZohoDesk.600123456',
        hint: 'invalid client_id or client_secret, or the client is not a Self Client',
      }),
    })
  })

  it('names the soid in the failure detail when Zoho cannot resolve the org', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { error: 'missing_org_info' }))

    await expect(mintZohoDeskServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'invalid_credentials',
      logDetail: expect.objectContaining({
        soid: 'ZohoDesk.600123456',
        hint: expect.stringContaining('Organization ID'),
      }),
    })
  })

  it('throws invalid_credentials on a 400 with an error body', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(400, { error: 'invalid_scope' }))

    await expect(mintZohoDeskServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'invalid_credentials',
      status: 400,
      logDetail: expect.objectContaining({
        hint: 'the Self Client was not granted the Zoho Desk scopes Sim requests',
      }),
    })
  })

  it('throws invalid_credentials on a 401', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(401, { error: 'unauthorized' }))

    await expect(mintZohoDeskServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'invalid_credentials',
      status: 401,
    })
  })

  it('throws provider_unavailable (not invalid_credentials) on a 429 rate limit', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(429, { error: 'too_many_requests' }))

    await expect(mintZohoDeskServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'provider_unavailable',
      status: 429,
    })
  })

  it('throws provider_unavailable on a 503', async () => {
    mockFetch.mockResolvedValueOnce(htmlResponse(503, '<html>unavailable</html>'))

    await expect(mintZohoDeskServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'provider_unavailable',
      status: 503,
    })
  })

  it('throws provider_unavailable on a 200 with a non-JSON body', async () => {
    mockFetch.mockResolvedValueOnce(htmlResponse(200, '<html>proxy page</html>'))

    await expect(mintZohoDeskServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'provider_unavailable',
      status: 502,
    })
  })

  it('throws provider_unavailable when the success body is missing access_token', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { token_type: 'Bearer' }))

    await expect(mintZohoDeskServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'provider_unavailable',
      status: 502,
    })
  })

  it('throws provider_unavailable on a network error', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'))

    await expect(mintZohoDeskServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'provider_unavailable',
      status: 502,
    })
  })
})
