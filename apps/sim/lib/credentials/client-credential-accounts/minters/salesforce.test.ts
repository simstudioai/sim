import { createVerify, generateKeyPairSync } from 'crypto'
import { jsonResponse } from '@sim/testing/helpers/http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mintSalesforceServiceAccountToken } from '@/lib/credentials/client-credential-accounts/minters/salesforce'

const HOST = 'yourorg.my.salesforce.com'
const TOKEN_URL = `https://${HOST}/services/oauth2/token`
const INSTANCE_URL = 'https://yourorg.my.salesforce.com'

const FIELDS = { clientId: 'test-consumer-key', clientSecret: 'sf-secret', orgId: HOST }

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
    vi.stubGlobal('fetch', mockFetch)
  })

  it('mints against the My Domain token endpoint and derives identity from userinfo', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: 'sf-access',
          instance_url: INSTANCE_URL,
          token_type: 'Bearer',
          token_format: 'opaque',
          scope: 'api',
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          name: 'Integration User',
          preferred_username: 'integration@yourorg.com',
          organization_id: '00Dxx0000000001EAA',
          user_id: '005xx000001Sv6DAAS',
        })
      )

    const result = await mintSalesforceServiceAccountToken(FIELDS)

    expect(result).toMatchObject({
      accessToken: 'sf-access',
      expiresInSeconds: 600,
      instanceUrl: INSTANCE_URL,
      identity: {
        principal: { kind: 'user', id: '005xx000001Sv6DAAS', label: 'integration@yourorg.com' },
        storedMetadata: { myDomainHost: HOST, orgId: '00Dxx0000000001EAA' },
      },
    })
    expectMintCall()
    expect(mockFetch.mock.calls[1][0]).toBe(`${INSTANCE_URL}/services/oauth2/userinfo`)
    expect(mockFetch.mock.calls[1][1].headers.Authorization).toBe('Bearer sf-access')
  })

  it('normalizes a pasted URL-style host before minting', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ access_token: 'sf-access' }))
      .mockResolvedValueOnce(jsonResponse({}, 403))

    const result = await mintSalesforceServiceAccountToken({
      ...FIELDS,
      orgId: 'https://YourOrg.My.Salesforce.com/some/path?x=1',
    })

    expectMintCall()
    expect(result.instanceUrl).toBe(INSTANCE_URL)
  })

  it.each(['yourorg--uat.sandbox.my.salesforce.com'])(
    'accepts the %s partitioned My Domain host',
    async (host) => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ access_token: 'sf-access' }))
        .mockResolvedValueOnce(jsonResponse({}, 403))

      await mintSalesforceServiceAccountToken({ ...FIELDS, orgId: host })

      expectMintCall(`https://${host}/services/oauth2/token`)
    }
  )

  it.each([
    'login.salesforce.com',
    'yourorg.my.salesforce.com.evil.com',
    'yourorg.evil.my.salesforce.com',
    'evil.com/yourorg.my.salesforce.com',
    'yourorg.my.salesforce.com@evil.com',
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
    [
      'invalid_grant',
      'Client Credentials Flow is not enabled on the Connected App, no "Run As" user is configured, or the Run As user is deactivated/frozen',
    ],
  ])('throws invalid_credentials with a hint on 400 %s', async (error, hint) => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error, error_description: 'nope' }, 400))

    await expect(mintSalesforceServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'invalid_credentials',
      status: 400,
      logDetail: expect.objectContaining({ hint }),
    })
  })

  it('throws provider_unavailable (not invalid_credentials) on a 429 rate limit', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'rate_limit_exceeded' }, 429))

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

  it('marks the principal as lookup_failed when userinfo omits user_id', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({ access_token: 'sf-access', instance_url: INSTANCE_URL })
      )
      .mockResolvedValueOnce(jsonResponse({ name: 'Integration User' }))

    const result = await mintSalesforceServiceAccountToken(FIELDS)

    expect(result.identity?.principal).toEqual({
      kind: 'lookup_failed',
      reason: 'response missing user_id',
    })
    // Only the principal degrades — a name that did come back still beats the
    // host fallback, so the credential does not lose its label.
    expect(result.identity?.displayName).toBe('Integration User')
  })

  it('ignores a non-Salesforce instance_url and falls back to the validated host', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({ access_token: 'sf-access', instance_url: 'https://evil.com' })
      )
      .mockResolvedValueOnce(jsonResponse({}, 403))

    const result = await mintSalesforceServiceAccountToken(FIELDS)

    expect(result.instanceUrl).toBe(INSTANCE_URL)
    expect(mockFetch.mock.calls[1][0]).toBe(`${INSTANCE_URL}/services/oauth2/userinfo`)
  })

  it('clamps the cache TTL to the exp claim when the token is a JWT', async () => {
    const exp = Math.floor(Date.now() / 1000) + 300
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: jwtWithExp(exp),
          instance_url: INSTANCE_URL,
          token_format: 'jwt',
        })
      )
      .mockResolvedValueOnce(jsonResponse({}, 403))

    const result = await mintSalesforceServiceAccountToken(FIELDS)

    expect(result.expiresInSeconds).toBeGreaterThan(230)
    expect(result.expiresInSeconds).toBeLessThanOrEqual(240)
  })
})

describe('mintSalesforceServiceAccountToken (JWT bearer)', () => {
  /**
   * A real 2048-bit RSA keypair, generated once per run. Signing against a
   * genuine key is the point: it is the only way to prove the assertion
   * verifies with `RS256` and that both PEM containers load.
   */
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const PKCS8_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const PKCS1_PEM = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()

  const JWT_FIELDS = {
    clientId: 'test-consumer-key',
    orgId: HOST,
    authMethod: 'jwt_bearer',
    username: 'integration.user@yourorg.com',
    privateKey: PKCS8_PEM,
  }

  /** Pulls the posted assertion apart and verifies its RS256 signature. */
  function readPostedAssertion(): {
    header: { alg: string; typ: string }
    claims: { aud: string; iss: string; sub: string; exp: number; iat: number }
    verified: boolean
  } {
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe(TOKEN_URL)
    const body = new URLSearchParams(init.body as string)
    expect(body.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer')
    expect(body.get('client_secret')).toBeNull()
    const assertion = body.get('assertion') as string
    const [header, claims, signature] = assertion.split('.')
    return {
      header: JSON.parse(Buffer.from(header, 'base64url').toString()),
      claims: JSON.parse(Buffer.from(claims, 'base64url').toString()),
      verified: createVerify('RSA-SHA256')
        .update(`${header}.${claims}`)
        .end()
        .verify(publicKey, Buffer.from(signature, 'base64url')),
    }
  }

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
  })

  it('posts an RS256 assertion whose signature verifies against the public key', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({ access_token: 'sf-jwt-token', instance_url: INSTANCE_URL })
      )
      .mockResolvedValueOnce(jsonResponse({}, 403))

    await mintSalesforceServiceAccountToken(JWT_FIELDS)

    const { header, verified } = readPostedAssertion()
    expect(header).toEqual({ alg: 'RS256', typ: 'JWT' })
    expect(verified).toBe(true)
  })

  it('audiences the assertion at the My Domain host with an exp inside the 5-minute window', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ access_token: 'sf-jwt-token' }))
      .mockResolvedValueOnce(jsonResponse({}, 403))

    await mintSalesforceServiceAccountToken(JWT_FIELDS)

    const { claims } = readPostedAssertion()
    expect(claims.aud).toBe(`https://${HOST}`)
    expect(claims.iss).toBe('test-consumer-key')
    expect(claims.sub).toBe('integration.user@yourorg.com')
    const secondsAhead = claims.exp - Math.floor(Date.now() / 1000)
    expect(secondsAhead).toBeGreaterThan(150)
    expect(secondsAhead).toBeLessThanOrEqual(180)
  })

  it.each([
    ['gs1.my.salesforce.com', 'https://gs1.salesforce.com'],
    ['gs1-widgets.my.salesforce.com', 'https://gs1-widgets.my.salesforce.com'],
  ])('audiences the %s org at %s while posting to its own host', async (orgId, audience) => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ access_token: 'sf-jwt-token' }))
      .mockResolvedValueOnce(jsonResponse({}, 403))

    await mintSalesforceServiceAccountToken({ ...JWT_FIELDS, orgId })

    const [url, init] = mockFetch.mock.calls[0]
    const assertion = new URLSearchParams(init.body as string).get('assertion') as string
    const claims = JSON.parse(Buffer.from(assertion.split('.')[1], 'base64url').toString())
    expect(claims.aud).toBe(audience)
    expect(url).toBe(`https://${orgId}/services/oauth2/token`)
  })

  it('accepts a PKCS#1 key, which is what OpenSSL 1.x emits', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ access_token: 'sf-jwt-token' }))
      .mockResolvedValueOnce(jsonResponse({}, 403))

    await mintSalesforceServiceAccountToken({ ...JWT_FIELDS, privateKey: PKCS1_PEM })

    expect(readPostedAssertion().verified).toBe(true)
  })

  it('rejects a passphrase-protected key without calling Salesforce', async () => {
    const encrypted = privateKey
      .export({
        type: 'pkcs8',
        format: 'pem',
        cipher: 'aes-256-cbc',
        passphrase: 'hunter2',
      })
      .toString()

    await expect(
      mintSalesforceServiceAccountToken({ ...JWT_FIELDS, privateKey: encrypted })
    ).rejects.toMatchObject({
      code: 'invalid_credentials',
      // The actionable remediation is the whole point of the branch; asserting
      // only the code lets the guard be deleted with the test still green.
      logDetail: { reason: expect.stringContaining('passphrase-protected') },
    })
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
