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

const mockFetch = vi.fn()

function mintBody(expectedUrl: string = TOKEN_URL): URLSearchParams {
  const [url, init] = mockFetch.mock.calls[0]
  expect(url).toBe(expectedUrl)
  expect(init.method).toBe('POST')
  expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
  return new URLSearchParams(init.body as string)
}

describe('mintZohoDeskServiceAccountToken', () => {
  beforeEach(() => {
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
        principal: { kind: 'tenant', id: 'ZohoDesk.600123456' },
        auditMetadata: { zohoDeskClientId: 'zoho-cid' },
        storedMetadata: {
          apiDomain: 'https://desk.zoho.com',
          dataCenter: 'us',
          grantedScopes: 'Desk.tickets.READ Desk.contacts.READ',
        },
      },
    })
  })

  it('sends client_credentials with a COMMA-separated scope list and a ZohoDesk-prefixed soid', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { access_token: 'zoho-access' }))

    await mintZohoDeskServiceAccountToken(FIELDS)

    const body = mintBody()
    expect(body.get('grant_type')).toBe('client_credentials')
    expect(body.get('client_id')).toBe('zoho-cid')
    expect(body.get('client_secret')).toBe('zoho-secret')
    // Comma-separated, and Desk-only: `aaaserver.profile.READ` belongs to the
    // interactive OAuth flow's getUserInfo call, which this grant never makes.
    expect(body.get('scope')).toBe('Desk.tickets.READ,Desk.contacts.READ')
    expect(body.get('scope')).not.toContain(' ')
    expect(body.get('scope')).not.toContain('aaaserver')
    expect(body.get('soid')).toBe('ZohoDesk.600123456')
  })

  it('passes an already-prefixed soid through unchanged', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { access_token: 'zoho-access' }))

    await mintZohoDeskServiceAccountToken({ ...FIELDS, orgId: ' ZohoCRM.600123456 ' })

    expect(mintBody().get('soid')).toBe('ZohoCRM.600123456')
  })

  it('falls back to the selected Desk base when api_domain is not a Zoho host', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, { access_token: 'a', api_domain: 'https://zoho.attacker.com' })
    )

    const result = await mintZohoDeskServiceAccountToken(FIELDS, { skipIdentity: true })

    expect(result.apiDomain).toBe('https://desk.zoho.com')
  })

  it('accepts the region code with surrounding whitespace and mixed case', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { access_token: 'zoho-access' }))

    const result = await mintZohoDeskServiceAccountToken(
      { ...FIELDS, dataCenter: '  EU ' },
      { skipIdentity: true }
    )

    mintBody('https://accounts.zoho.eu/oauth/v2/token')
    expect(result.apiDomain).toBe('https://desk.zoho.eu')
  })

  it.each(['   '])('defaults to the US data center when dataCenter is %j', async (dataCenter) => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { access_token: 'zoho-access' }))

    const result = await mintZohoDeskServiceAccountToken(
      { ...FIELDS, dataCenter },
      { skipIdentity: true }
    )

    mintBody(TOKEN_URL)
    expect(result.apiDomain).toBe('https://desk.zoho.com')
  })

  // A typed-but-unrecognized region must NOT quietly resolve to US and then fail
  // against Zoho as an opaque invalid_client — the operator would have no way to
  // tell a wrong region from wrong credentials. Blank still means US (see above).
  it('rejects an unrecognized data center instead of silently using US', async () => {
    await expect(
      mintZohoDeskServiceAccountToken({ ...FIELDS, dataCenter: 'jp' })
    ).rejects.toMatchObject({
      code: 'invalid_credentials',
      status: 400,
      logDetail: expect.objectContaining({ step: 'data_center_validation', dataCenter: 'jp' }),
    })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('prefers an allowlisted api_domain over the selected region', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, { access_token: 'zoho-access', api_domain: 'https://www.zohoapis.in' })
    )

    const result = await mintZohoDeskServiceAccountToken(
      { ...FIELDS, dataCenter: 'eu' },
      { skipIdentity: true }
    )

    mintBody('https://accounts.zoho.eu/oauth/v2/token')
    expect(result.apiDomain).toBe('https://desk.zoho.in')
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
        // Matched loosely: the hint's exact wording is operator-facing copy, but
        // it must keep naming the data center, since a wrong region is a leading
        // cause of invalid_client on reconnect.
        hint: expect.stringContaining('data center'),
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
})
