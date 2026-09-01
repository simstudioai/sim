/**
 * @vitest-environment node
 */
import { createVerify, generateKeyPairSync } from 'crypto'
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
          user_id: '005xx000001Sv6DAAS',
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
        principal: {
          kind: 'user',
          id: '005xx000001Sv6DAAS',
          label: 'integration@yourorg.com',
        },
        auditMetadata: {
          salesforceMyDomainHost: HOST,
          salesforceOrgId: '00Dxx0000000001EAA',
        },
        storedMetadata: {
          myDomainHost: HOST,
          instanceUrl: INSTANCE_URL,
          orgId: '00Dxx0000000001EAA',
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

  it('marks the principal as lookup_failed when the userinfo call throws', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse(200, { access_token: 'sf-access', instance_url: INSTANCE_URL })
      )
      .mockRejectedValueOnce(new TypeError('fetch failed'))

    const result = await mintSalesforceServiceAccountToken(FIELDS)

    expect(result.accessToken).toBe('sf-access')
    expect(result.identity).toEqual({
      displayName: `Salesforce ${HOST}`,
      principal: { kind: 'lookup_failed', reason: 'provider_unavailable (HTTP 502)' },
      auditMetadata: { salesforceMyDomainHost: HOST },
      storedMetadata: { myDomainHost: HOST, instanceUrl: INSTANCE_URL },
    })
  })

  it('marks the principal as lookup_failed when userinfo omits user_id', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse(200, { access_token: 'sf-access', instance_url: INSTANCE_URL })
      )
      .mockResolvedValueOnce(jsonResponse(200, { name: 'Integration User' }))

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
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts an RS256 assertion whose signature verifies against the public key', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse(200, { access_token: 'sf-jwt-token', instance_url: INSTANCE_URL })
      )
      .mockResolvedValueOnce(jsonResponse(403, {}))

    await mintSalesforceServiceAccountToken(JWT_FIELDS)

    const { header, verified } = readPostedAssertion()
    expect(header).toEqual({ alg: 'RS256', typ: 'JWT' })
    expect(verified).toBe(true)
  })

  it('audiences the assertion at the My Domain host, never login/test.salesforce.com', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'sf-jwt-token' }))
      .mockResolvedValueOnce(jsonResponse(403, {}))

    await mintSalesforceServiceAccountToken(JWT_FIELDS)

    const { claims } = readPostedAssertion()
    // Salesforce Spring '26 ended legacy hostname redirections; an External
    // Client App rejects the generic hosts with `app_not_found`.
    expect(claims.aud).toBe(`https://${HOST}`)
    expect(claims.iss).toBe('test-consumer-key')
    expect(claims.sub).toBe('integration.user@yourorg.com')
  })

  it('audiences a Government Cloud org at gs1.salesforce.com, not its My Domain', async () => {
    // Salesforce's own sfdx-core substitutes this audience for gs1 orgs, whose
    // hosts are otherwise ordinary *.my.salesforce.com.
    mockFetch
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'sf-jwt-token' }))
      .mockResolvedValueOnce(jsonResponse(403, {}))

    await mintSalesforceServiceAccountToken({ ...JWT_FIELDS, orgId: 'gs1.my.salesforce.com' })

    const [url, init] = mockFetch.mock.calls[0]
    const assertion = new URLSearchParams(init.body as string).get('assertion') as string
    const claims = JSON.parse(Buffer.from(assertion.split('.')[1], 'base64url').toString())
    expect(claims.aud).toBe('https://gs1.salesforce.com')
    // The token still POSTs to the org's own host — only the audience differs.
    expect(url).toBe('https://gs1.my.salesforce.com/services/oauth2/token')
  })

  it('does NOT treat an ordinary org whose name merely starts with gs1 as Government Cloud', async () => {
    // A prefix test would misroute this org to the GovCloud audience and break
    // a setup that works today. Only the real GovCloud host may be rewritten.
    mockFetch
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'sf-jwt-token' }))
      .mockResolvedValueOnce(jsonResponse(403, {}))

    await mintSalesforceServiceAccountToken({
      ...JWT_FIELDS,
      orgId: 'gs1-widgets.my.salesforce.com',
    })

    const assertion = new URLSearchParams(mockFetch.mock.calls[0][1].body as string).get(
      'assertion'
    ) as string
    const claims = JSON.parse(Buffer.from(assertion.split('.')[1], 'base64url').toString())
    expect(claims.aud).toBe('https://gs1-widgets.my.salesforce.com')
  })

  it('carries an iat claim, matching every mainstream Salesforce implementation', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'sf-jwt-token' }))
      .mockResolvedValueOnce(jsonResponse(403, {}))

    await mintSalesforceServiceAccountToken(JWT_FIELDS)

    const { claims } = readPostedAssertion()
    expect(claims.iat).toBeLessThanOrEqual(Math.floor(Date.now() / 1000))
    expect(claims.exp).toBeGreaterThan(claims.iat)
  })

  it('maps an unassigned profile to a permission-set hint', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(400, {
        error: 'invalid_app_access',
        error_description: 'user is not admin approved to access this app',
      })
    )

    await expect(mintSalesforceServiceAccountToken(JWT_FIELDS)).rejects.toMatchObject({
      code: 'invalid_credentials',
      logDetail: { hint: expect.stringContaining('profile or permission set is not assigned') },
    })
  })

  it('sets a short expiry inside the 5-minute window Salesforce allows', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'sf-jwt-token' }))
      .mockResolvedValueOnce(jsonResponse(403, {}))

    await mintSalesforceServiceAccountToken(JWT_FIELDS)

    const { claims } = readPostedAssertion()
    const secondsAhead = claims.exp - Math.floor(Date.now() / 1000)
    // Salesforce rejects an exp more than 5 minutes out; 180s is the value the
    // minter uses, so the band is tight enough to catch drift in either direction.
    expect(secondsAhead).toBeGreaterThan(150)
    expect(secondsAhead).toBeLessThanOrEqual(180)
  })

  it('accepts a PKCS#1 key, which is what OpenSSL 1.x emits', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'sf-jwt-token' }))
      .mockResolvedValueOnce(jsonResponse(403, {}))

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

  it('rejects an unreadable key without calling Salesforce', async () => {
    await expect(
      mintSalesforceServiceAccountToken({ ...JWT_FIELDS, privateKey: 'not-a-pem' })
    ).rejects.toMatchObject({ code: 'invalid_credentials' })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('rejects a JWT credential missing its username without calling Salesforce', async () => {
    await expect(
      mintSalesforceServiceAccountToken({ ...JWT_FIELDS, username: undefined })
    ).rejects.toMatchObject({ code: 'invalid_credentials' })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('still uses client credentials when no auth method is stored', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'sf-token' }))
      .mockResolvedValueOnce(jsonResponse(403, {}))

    await mintSalesforceServiceAccountToken(FIELDS)

    const body = new URLSearchParams(mockFetch.mock.calls[0][1].body as string)
    expect(body.get('grant_type')).toBe('client_credentials')
  })

  it('maps app_not_found to a hint naming the org/consumer-key mismatch', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(400, {
        error: 'app_not_found',
        error_description: 'External client app is not installed in this org',
      })
    )

    await expect(mintSalesforceServiceAccountToken(JWT_FIELDS)).rejects.toMatchObject({
      code: 'invalid_credentials',
      logDetail: { hint: expect.stringContaining('not installed in this org') },
    })
  })

  it.each([
    ['straight apostrophe', "user hasn't approved this consumer"],
    // Salesforce's real error text uses a typographic apostrophe. Covering only
    // the straight form let that branch be deleted without failing CI.
    ['typographic apostrophe', 'user hasn\u2019t approved this consumer'],
  ])('maps an unapproved run-as user (%s) to a pre-authorization hint', async (_l, description) => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(400, { error: 'invalid_grant', error_description: description })
    )

    await expect(mintSalesforceServiceAccountToken(JWT_FIELDS)).rejects.toMatchObject({
      code: 'invalid_credentials',
      logDetail: { hint: expect.stringContaining('Admin approved users are pre-authorized') },
    })
  })
})
