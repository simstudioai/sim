/**
 * @vitest-environment node
 */
import { generateKeyPairSync } from 'node:crypto'
import { jwtVerify } from 'jose'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mintNetSuiteServiceAccountToken } from '@/lib/credentials/client-credential-accounts/minters/netsuite'

const ORIGIN = 'https://1234567-sb1.suitetalk.api.netsuite.com'
const TOKEN_URL = `${ORIGIN}/services/rest/auth/oauth2/v1/token`
const rsaKeyPair = generateKeyPairSync('rsa', { modulusLength: 3072 })
const RSA_PRIVATE_KEY = rsaKeyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const UNSUPPORTED_RSA_PRIVATE_KEY = generateKeyPairSync('rsa', { modulusLength: 2048 })
  .privateKey.export({ type: 'pkcs8', format: 'pem' })
  .toString()
const UNSUPPORTED_EC_PRIVATE_KEY = generateKeyPairSync('ec', { namedCurve: 'secp256k1' })
  .privateKey.export({ type: 'pkcs8', format: 'pem' })
  .toString()
const EC_KEY_CASES = (
  [
    { namedCurve: 'P-256', algorithm: 'ES256' },
    { namedCurve: 'P-384', algorithm: 'ES384' },
    { namedCurve: 'P-521', algorithm: 'ES512' },
  ] as const
).map(({ namedCurve, algorithm }) => {
  const pair = generateKeyPairSync('ec', { namedCurve })
  return {
    namedCurve,
    algorithm,
    privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKey: pair.publicKey,
  }
})

const FIELDS = {
  orgId: ORIGIN,
  clientId: 'client-id',
  certificateId: 'certificate-id',
  privateKey: RSA_PRIVATE_KEY,
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function assertionFrom(init: RequestInit): string {
  const body = new URLSearchParams(String(init.body))
  expect(body.get('grant_type')).toBe('client_credentials')
  expect(body.get('client_assertion_type')).toBe(
    'urn:ietf:params:oauth:client-assertion-type:jwt-bearer'
  )
  const assertion = body.get('client_assertion')
  expect(assertion).toBeTruthy()
  return assertion as string
}

describe('mintNetSuiteServiceAccountToken', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('signs the Oracle client assertion with PS256 and returns account metadata', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ access_token: 'netsuite-access', expires_in: 1800, token_type: 'Bearer' })
      )
    vi.stubGlobal('fetch', fetchMock)

    const result = await mintNetSuiteServiceAccountToken(FIELDS)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(TOKEN_URL)
    expect(init).toMatchObject({
      method: 'POST',
      redirect: 'error',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    expect(init.signal).toBeInstanceOf(AbortSignal)
    const assertion = assertionFrom(init)
    const verified = await jwtVerify(assertion, rsaKeyPair.publicKey, {
      algorithms: ['PS256'],
      audience: TOKEN_URL,
      issuer: FIELDS.clientId,
    })
    expect(verified.protectedHeader).toMatchObject({
      typ: 'JWT',
      alg: 'PS256',
      kid: FIELDS.certificateId,
    })
    expect(verified.payload.scope).toBe('rest_webservices')
    expect(verified.payload.jti).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
    expect(verified.payload.exp).toBe((verified.payload.iat as number) + 300)
    expect(result).toEqual({
      accessToken: 'netsuite-access',
      expiresInSeconds: 1800,
      instanceUrl: ORIGIN,
      identity: {
        displayName: 'Oracle NetSuite 1234567-sb1',
        principal: {
          kind: 'tenant',
          id: '1234567-sb1',
          label: '1234567-sb1.suitetalk.api.netsuite.com',
        },
        auditMetadata: {
          netSuiteAccountId: '1234567-sb1',
          netSuiteSuiteTalkOrigin: ORIGIN,
        },
        storedMetadata: {
          accountId: '1234567-sb1',
          suiteTalkOrigin: ORIGIN,
        },
      },
    })
  })

  it.each(EC_KEY_CASES)(
    'signs a $namedCurve assertion with $algorithm',
    async ({ algorithm, privateKey, publicKey }) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ access_token: 'netsuite-access', expires_in: 3600, token_type: 'bearer' })
        )
      vi.stubGlobal('fetch', fetchMock)

      await mintNetSuiteServiceAccountToken({ ...FIELDS, privateKey }, { skipIdentity: true })

      const assertion = assertionFrom(fetchMock.mock.calls[0][1] as RequestInit)
      const verified = await jwtVerify(assertion, publicKey, {
        algorithms: [algorithm],
        audience: TOKEN_URL,
        issuer: FIELDS.clientId,
      })
      expect(verified.protectedHeader).toMatchObject({
        typ: 'JWT',
        alg: algorithm,
        kid: FIELDS.certificateId,
      })
    }
  )

  it('accepts Oracle-supported 4096-bit RSA keys with PS256', async () => {
    const pair = generateKeyPairSync('rsa', { modulusLength: 4096 })
    const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ access_token: 'netsuite-access', expires_in: 3600, token_type: 'Bearer' })
      )
    vi.stubGlobal('fetch', fetchMock)

    await mintNetSuiteServiceAccountToken({ ...FIELDS, privateKey }, { skipIdentity: true })

    const assertion = assertionFrom(fetchMock.mock.calls[0][1] as RequestInit)
    await expect(
      jwtVerify(assertion, pair.publicKey, {
        algorithms: ['PS256'],
        audience: TOKEN_URL,
        issuer: FIELDS.clientId,
      })
    ).resolves.toBeDefined()
  })

  it('omits connect-time identity when resolving an execution token', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ access_token: 'netsuite-access', expires_in: 3600, token_type: 'Bearer' })
        )
    )

    await expect(mintNetSuiteServiceAccountToken(FIELDS, { skipIdentity: true })).resolves.toEqual({
      accessToken: 'netsuite-access',
      expiresInSeconds: 3600,
      instanceUrl: ORIGIN,
    })
  })

  it.each([
    'http://1234567.suitetalk.api.netsuite.com',
    'https://evil.example',
    `${ORIGIN}/services/rest/record/v1/customer`,
    `${ORIGIN}?account=other`,
    'https://user:password@1234567.suitetalk.api.netsuite.com',
  ])('rejects the SuiteTalk URL %j before fetching', async (orgId) => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(mintNetSuiteServiceAccountToken({ ...FIELDS, orgId })).rejects.toMatchObject({
      code: 'site_not_found',
      status: 400,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    [UNSUPPORTED_RSA_PRIVATE_KEY, 'RSA private key must be 3072 or 4096 bits'],
    [UNSUPPORTED_EC_PRIVATE_KEY, 'EC private key must use P-256, P-384, or P-521'],
  ])('rejects an unsupported key before fetching', async (privateKey, reason) => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(mintNetSuiteServiceAccountToken({ ...FIELDS, privateKey })).rejects.toMatchObject({
      code: 'invalid_credentials',
      logDetail: expect.objectContaining({ reason }),
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    [400, 'invalid_credentials'],
    [401, 'invalid_credentials'],
    [408, 'provider_unavailable'],
    [429, 'provider_unavailable'],
    [503, 'provider_unavailable'],
  ] as const)('classifies an HTTP %i token failure as %s', async (status, code) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'denied' }, status)))

    await expect(mintNetSuiteServiceAccountToken(FIELDS)).rejects.toMatchObject({ code, status })
  })

  it('redacts credentials and a reflected assertion from provider error metadata', async () => {
    let assertion = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        assertion = assertionFrom(init)
        return new Response(
          `${FIELDS.clientId} ${FIELDS.certificateId} ${FIELDS.privateKey} ${assertion}`,
          { status: 400 }
        )
      })
    )

    const error = await mintNetSuiteServiceAccountToken(FIELDS).catch((caught: unknown) => caught)
    expect(error).toMatchObject({ code: 'invalid_credentials' })
    const detail = JSON.stringify((error as { logDetail?: unknown }).logDetail)
    expect(detail).not.toContain(FIELDS.clientId)
    expect(detail).not.toContain(FIELDS.certificateId)
    expect(detail).not.toContain('BEGIN PRIVATE KEY')
    expect(detail).not.toContain(assertion)
  })

  it('bounds provider error bodies before attaching safe metadata', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('x'.repeat(64 * 1024 + 1), { status: 400 }))
    )

    const error = await mintNetSuiteServiceAccountToken(FIELDS).catch((caught: unknown) => caught)
    expect(error).toMatchObject({
      code: 'invalid_credentials',
      logDetail: {
        step: 'netsuite_token_mint',
        body: 'provider error response exceeded the allowed size or could not be read',
      },
    })
  })

  it.each([
    [7200, 3600],
    [60, 60],
  ])('caps a valid expires_in=%s at %i seconds', async (expiresIn, expected) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          access_token: 'netsuite-access',
          expires_in: expiresIn,
          token_type: expiresIn === 60 ? 'bEaReR' : 'Bearer',
        })
      )
    )

    const result = await mintNetSuiteServiceAccountToken(FIELDS, { skipIdentity: true })
    expect(result.expiresInSeconds).toBe(expected)
  })

  it('maps invalid, missing, and oversized success bodies to provider_unavailable', async () => {
    const responses = [
      new Response('not-json', { status: 200 }),
      jsonResponse(null),
      jsonResponse({ expires_in: 3600, token_type: 'Bearer' }),
      jsonResponse({ access_token: '   ', expires_in: 3600, token_type: 'Bearer' }),
      jsonResponse({ access_token: 'netsuite-access', token_type: 'Bearer' }),
      jsonResponse({ access_token: 'netsuite-access', expires_in: 0, token_type: 'Bearer' }),
      jsonResponse({ access_token: 'netsuite-access', expires_in: -1, token_type: 'Bearer' }),
      jsonResponse({ access_token: 'netsuite-access', expires_in: '3600', token_type: 'Bearer' }),
      jsonResponse({ access_token: 'netsuite-access', expires_in: null, token_type: 'Bearer' }),
      new Response('{"access_token":"netsuite-access","expires_in":1e999,"token_type":"Bearer"}', {
        status: 200,
      }),
      jsonResponse({ access_token: 'netsuite-access', expires_in: 3600 }),
      jsonResponse({ access_token: 'netsuite-access', expires_in: 3600, token_type: 1 }),
      jsonResponse({ access_token: 'netsuite-access', expires_in: 3600, token_type: 'mac' }),
      new Response(
        JSON.stringify({
          access_token: 'x'.repeat(1024 * 1024 + 1),
          expires_in: 3600,
          token_type: 'Bearer',
        }),
        { status: 200 }
      ),
    ]
    const fetchMock = vi.fn()
    for (const response of responses) fetchMock.mockResolvedValueOnce(response)
    vi.stubGlobal('fetch', fetchMock)

    for (const _response of responses) {
      await expect(mintNetSuiteServiceAccountToken(FIELDS)).rejects.toMatchObject({
        code: 'provider_unavailable',
      })
    }
  })

  it('maps a network or timeout rejection to provider_unavailable without leaking details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(`failed for ${FIELDS.clientId}`)))

    await expect(mintNetSuiteServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'provider_unavailable',
      status: 502,
      logDetail: { step: 'netsuite_token_mint', reason: 'network error reaching provider' },
    })
  })

  it('applies the 30-second exchange deadline to the provider request', async () => {
    const controller = new AbortController()
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal)
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => {
        const signal = init.signal as AbortSignal
        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
          controller.abort(new DOMException('timed out', 'TimeoutError'))
        })
      })
    )

    await expect(mintNetSuiteServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'provider_unavailable',
      status: 502,
    })
    expect(timeoutSpy).toHaveBeenCalledWith(30_000)
  })
})
