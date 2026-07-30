/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mintSalesforceServiceAccountToken } from '@/lib/credentials/client-credential-accounts/minters/salesforce'

const HOST = 'yourorg.my.salesforce.com'
const TOKEN_URL = `https://${HOST}/services/oauth2/token`
const INSTANCE_URL = 'https://yourorg.my.salesforce.com'

const FIELDS = { clientId: 'test-consumer-key', clientSecret: 'sf-secret', orgId: HOST }

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

/** Builds a structurally valid unsigned JWT carrying the given exp claim. */
function jwtWithExp(expSeconds: number): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'none' })}.${encode({ exp: expSeconds })}.sig`
}

const mockFetch = vi.fn()

function expectMintCall(expectedUrl = TOKEN_URL): void {
  const [url, init] = mockFetch.mock.calls[0]
  expect(url).toBe(expectedUrl)
  expect(init.method).toBe('POST')
  expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
  const body = new URLSearchParams(init.body as string)
  expect(body.get('grant_type')).toBe('client_credentials')
  expect(body.get('client_id')).toBe('test-consumer-key')
  expect(body.get('client_secret')).toBe('sf-secret')
  expect(body.get('scope')).toBeNull()
}

describe('mintSalesforceServiceAccountToken', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('mints against the My Domain token endpoint and derives identity from userinfo', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse(200, {
          access_token: 'sf-access',
          instance_url: INSTANCE_URL,
          token_type: 'Bearer',
          token_format: 'opaque',
          scope: 'api',
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          name: 'Integration User',
          preferred_username: 'integration@yourorg.com',
          organization_id: '00Dxx0000000001EAA',
        })
      )

    const result = await mintSalesforceServiceAccountToken(FIELDS)

    expect(result).toEqual({
      accessToken: 'sf-access',
      expiresInSeconds: 600,
      instanceUrl: INSTANCE_URL,
      grantedScopes: ['api'],
      identity: {
        displayName: 'Integration User',
        auditMetadata: {
          salesforceMyDomainHost: HOST,
          salesforceOrgId: '00Dxx0000000001EAA',
          salesforceRunAsUsername: 'integration@yourorg.com',
        },
        storedMetadata: {
          myDomainHost: HOST,
          instanceUrl: INSTANCE_URL,
          orgId: '00Dxx0000000001EAA',
          runAsUsername: 'integration@yourorg.com',
          grantedScopes: 'api',
        },
      },
    })
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expectMintCall()
    expect(mockFetch.mock.calls[1][0]).toBe(`${INSTANCE_URL}/services/oauth2/userinfo`)
    expect(mockFetch.mock.calls[1][1].headers.Authorization).toBe('Bearer sf-access')
  })

  it('normalizes a pasted URL-style host before minting', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'sf-access' }))
      .mockResolvedValueOnce(jsonResponse(403, {}))

    const result = await mintSalesforceServiceAccountToken({
      ...FIELDS,
      orgId: 'https://YourOrg.My.Salesforce.com/some/path?x=1',
    })

    expectMintCall()
    expect(result.instanceUrl).toBe(INSTANCE_URL)
  })

  it.each([
    'yourorg--uat.sandbox.my.salesforce.com',
    'yourorg-dev-ed.develop.my.salesforce.com',
    'yourorg--sbx.scratch.my.salesforce.com',
  ])('accepts the %s partitioned My Domain host', async (host) => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'sf-access' }))
      .mockResolvedValueOnce(jsonResponse(403, {}))

    await mintSalesforceServiceAccountToken({ ...FIELDS, orgId: host })

    expectMintCall(`https://${host}/services/oauth2/token`)
  })

  it.each([
    'evil.com',
    'login.salesforce.com',
    'test.salesforce.com',
    'yourorg.my.salesforce.com.evil.com',
    'my.salesforce.com',
    'yourorg.evil.my.salesforce.com',
    'evil.com/yourorg.my.salesforce.com',
    'evil.com#yourorg.my.salesforce.com',
    'yourorg.my.salesforce.mil',
    'yourorg.my.salesforce.com@evil.com',
    'yourorg.my.salesforce.com:8443',
    'yourorg.my.salesforce.com.',
    '',
  ])('rejects the host %j before any outbound fetch', async (host) => {
    await expect(
      mintSalesforceServiceAccountToken({ ...FIELDS, orgId: host })
    ).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'site_not_found',
      status: 400,
      logDetail: expect.objectContaining({ step: 'host_validation' }),
    })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it.each([
    ['invalid_client_id', 'consumer key or consumer secret is invalid'],
    ['invalid_client', 'consumer key or consumer secret is invalid'],
    [
      'invalid_grant',
      'Client Credentials Flow is not enabled on the Connected App, no "Run As" user is configured, or the Run As user is deactivated/frozen',
    ],
  ])('throws invalid_credentials with a hint on 400 %s', async (error, hint) => {
    mockFetch.mockResolvedValueOnce(jsonResponse(400, { error, error_description: 'nope' }))

    await expect(mintSalesforceServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'invalid_credentials',
      status: 400,
      logDetail: expect.objectContaining({ hint }),
    })
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('skips the userinfo lookup when skipIdentity is set', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, { access_token: 'sf-access', instance_url: INSTANCE_URL, scope: 'api' })
    )

    const result = await mintSalesforceServiceAccountToken(FIELDS, { skipIdentity: true })

    expect(result).toEqual({
      accessToken: 'sf-access',
      expiresInSeconds: 600,
      instanceUrl: INSTANCE_URL,
      grantedScopes: ['api'],
    })
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('throws provider_unavailable (not invalid_credentials) on a 429 rate limit', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(429, { error: 'rate_limit_exceeded' }))

    await expect(mintSalesforceServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'provider_unavailable',
      status: 429,
    })
  })

  it('maps a DNS-resolution failure on the My Domain host to site_not_found', async () => {
    const dnsError = new TypeError('fetch failed')
    ;(dnsError as { cause?: unknown }).cause = Object.assign(new Error('getaddrinfo ENOTFOUND'), {
      code: 'ENOTFOUND',
    })
    mockFetch.mockRejectedValueOnce(dnsError)

    await expect(mintSalesforceServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'site_not_found',
      status: 400,
      logDetail: expect.objectContaining({
        reason: 'host does not resolve — check the My Domain host',
      }),
    })
  })

  it('throws provider_unavailable on 503', async () => {
    mockFetch.mockResolvedValueOnce(htmlResponse(503, '<html>maintenance</html>'))

    await expect(mintSalesforceServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'provider_unavailable',
      status: 503,
    })
  })

  it('throws provider_unavailable on a 200 with a non-JSON body', async () => {
    mockFetch.mockResolvedValueOnce(htmlResponse(200, '<html>proxy page</html>'))

    await expect(mintSalesforceServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'provider_unavailable',
      status: 502,
    })
  })

  it('throws provider_unavailable when the success body is missing access_token', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { instance_url: INSTANCE_URL }))

    await expect(mintSalesforceServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'provider_unavailable',
      status: 502,
    })
  })

  it('throws provider_unavailable on a network error', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'))

    await expect(mintSalesforceServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'provider_unavailable',
      status: 502,
    })
  })

  it('falls back to a host-derived identity when the userinfo call fails', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse(200, { access_token: 'sf-access', instance_url: INSTANCE_URL })
      )
      .mockRejectedValueOnce(new TypeError('fetch failed'))

    const result = await mintSalesforceServiceAccountToken(FIELDS)

    expect(result.accessToken).toBe('sf-access')
    expect(result.identity).toEqual({
      displayName: `Salesforce ${HOST}`,
      auditMetadata: { salesforceMyDomainHost: HOST },
      storedMetadata: { myDomainHost: HOST, instanceUrl: INSTANCE_URL },
    })
  })

  it('ignores a non-Salesforce instance_url and falls back to the validated host', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse(200, { access_token: 'sf-access', instance_url: 'https://evil.com' })
      )
      .mockResolvedValueOnce(jsonResponse(403, {}))

    const result = await mintSalesforceServiceAccountToken(FIELDS)

    expect(result.instanceUrl).toBe(INSTANCE_URL)
    expect(mockFetch.mock.calls[1][0]).toBe(`${INSTANCE_URL}/services/oauth2/userinfo`)
  })

  it('clamps the cache TTL to the exp claim when the token is a JWT', async () => {
    const exp = Math.floor(Date.now() / 1000) + 300
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse(200, {
          access_token: jwtWithExp(exp),
          instance_url: INSTANCE_URL,
          token_format: 'jwt',
        })
      )
      .mockResolvedValueOnce(jsonResponse(403, {}))

    const result = await mintSalesforceServiceAccountToken(FIELDS)

    expect(result.expiresInSeconds).toBeGreaterThan(230)
    expect(result.expiresInSeconds).toBeLessThanOrEqual(240)
  })

  it('caps a long-lived JWT exp at the conservative 10-minute TTL', async () => {
    const exp = Math.floor(Date.now() / 1000) + 7200
    mockFetch
      .mockResolvedValueOnce(jsonResponse(200, { access_token: jwtWithExp(exp) }))
      .mockResolvedValueOnce(jsonResponse(403, {}))

    const result = await mintSalesforceServiceAccountToken(FIELDS)

    expect(result.expiresInSeconds).toBe(600)
  })
})
