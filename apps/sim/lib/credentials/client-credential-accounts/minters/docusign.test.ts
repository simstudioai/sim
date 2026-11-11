import { generateKeyPairSync } from 'crypto'
import { jsonResponse } from '@sim/testing/helpers/http'
import { decodeProtectedHeader, jwtVerify } from 'jose'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mintDocuSignServiceAccountToken } from '@/lib/credentials/client-credential-accounts/minters/docusign'

const INTEGRATION_KEY = '11111111-2222-3333-4444-555555555555'
const USER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const DEFAULT_ACCOUNT = '99999999-0000-0000-0000-000000000001'
const OTHER_ACCOUNT = '99999999-0000-0000-0000-000000000002'

const { privateKey: RSA_PEM, publicKey: RSA_PUBLIC } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})
const EC_PEM = generateKeyPairSync('ec', {
  namedCurve: 'P-256',
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
}).privateKey
const SHORT_RSA_PEM = generateKeyPairSync('rsa', {
  modulusLength: 1024,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
}).privateKey

const FIELDS = {
  clientId: INTEGRATION_KEY,
  username: USER_ID,
  privateKey: RSA_PEM,
  dataCenter: 'demo',
  orgId: '',
}

const ACCESS_TOKEN = 'test-docusign-access-token'

function userinfo(accounts: Array<Record<string, unknown>>) {
  return jsonResponse({
    sub: USER_ID,
    name: 'Integration User',
    email: 'ops@example.com',
    accounts,
  })
}

const DEMO_ACCOUNTS = [
  {
    account_id: OTHER_ACCOUNT,
    is_default: false,
    account_name: 'Other',
    base_uri: 'https://demo.docusign.net',
  },
  {
    account_id: DEFAULT_ACCOUNT,
    is_default: true,
    account_name: 'Main',
    base_uri: 'https://demo.docusign.net',
  },
]

const mockFetch = vi.fn()

function mockMint(accounts = DEMO_ACCOUNTS) {
  mockFetch
    .mockResolvedValueOnce(
      jsonResponse({ access_token: ACCESS_TOKEN, token_type: 'Bearer', expires_in: 3600 })
    )
    .mockResolvedValueOnce(userinfo(accounts))
}

/** Every string a failure exposes: its message plus the log detail callers write to logs. */
function exposedText(error: unknown): string {
  const failure = error as { message?: string; logDetail?: unknown }
  return `${failure.message} ${JSON.stringify(failure.logDetail)}`
}

describe('mintDocuSignServiceAccountToken', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
  })

  it('signs the documented assertion for the demo environment and binds the default account', async () => {
    mockMint()

    const result = await mintDocuSignServiceAccountToken(FIELDS)

    const [tokenUrl, tokenInit] = mockFetch.mock.calls[0]
    expect(tokenUrl).toBe('https://account-d.docusign.com/oauth/token')
    const body = new URLSearchParams(tokenInit.body as string)
    expect(body.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer')
    const assertion = body.get('assertion') ?? ''
    expect(decodeProtectedHeader(assertion)).toMatchObject({ alg: 'RS256', typ: 'JWT' })
    const { createPublicKey } = await import('crypto')
    const { payload } = await jwtVerify(assertion, createPublicKey(RSA_PUBLIC), {
      issuer: INTEGRATION_KEY,
      subject: USER_ID,
      audience: 'account-d.docusign.com',
    })
    expect(payload.scope).toBe('signature impersonation')
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBeLessThanOrEqual(3600)

    expect(mockFetch.mock.calls[1][0]).toBe('https://account-d.docusign.com/oauth/userinfo')
    expect(mockFetch.mock.calls[1][1].headers.Authorization).toBe(`Bearer ${ACCESS_TOKEN}`)
    expect(result).toMatchObject({
      accessToken: ACCESS_TOKEN,
      expiresInSeconds: 3000,
      instanceUrl: `https://demo.docusign.net/restapi/v2.1/accounts/${DEFAULT_ACCOUNT}`,
      identity: { principal: { kind: 'user', id: USER_ID } },
    })
  })

  it('mints and resolves accounts on the production host when the credential says production', async () => {
    mockMint([
      {
        account_id: DEFAULT_ACCOUNT,
        is_default: true,
        account_name: 'Production',
        base_uri: 'https://na3.docusign.net',
      },
    ])

    const result = await mintDocuSignServiceAccountToken({ ...FIELDS, dataCenter: 'production' })

    expect(mockFetch.mock.calls[0][0]).toBe('https://account.docusign.com/oauth/token')
    expect(mockFetch.mock.calls[1][0]).toBe('https://account.docusign.com/oauth/userinfo')
    expect(result.instanceUrl).toBe(
      `https://na3.docusign.net/restapi/v2.1/accounts/${DEFAULT_ACCOUNT}`
    )
  })

  it('binds the pinned account rather than the default one', async () => {
    mockMint()

    const result = await mintDocuSignServiceAccountToken({ ...FIELDS, orgId: OTHER_ACCOUNT })

    expect(result.instanceUrl).toBe(
      `https://demo.docusign.net/restapi/v2.1/accounts/${OTHER_ACCOUNT}`
    )
  })

  it('refuses a pinned account the user does not belong to', async () => {
    mockMint()

    await expect(
      mintDocuSignServiceAccountToken({
        ...FIELDS,
        orgId: '99999999-0000-0000-0000-000000000003',
      })
    ).rejects.toMatchObject({ code: 'account_not_found' })
  })

  it.each([
    ['https://evil.example.com', 'demo'],
    ['https://na3.docusign.net', 'demo'],
    ['https://demo.docusign.net', 'production'],
    ['http://na3.docusign.net', 'production'],
  ])('never binds a %s base_uri to a %s credential', async (baseUri, environment) => {
    mockMint([
      {
        account_id: DEFAULT_ACCOUNT,
        is_default: true,
        account_name: 'Default',
        base_uri: baseUri,
      },
    ])

    await expect(
      mintDocuSignServiceAccountToken({ ...FIELDS, dataCenter: environment })
    ).rejects.toMatchObject({ code: 'provider_unavailable' })
  })

  it.each([
    ['an absent environment', { dataCenter: undefined }],
    ['an environment that is a host', { dataCenter: 'https://evil.example.com' }],
    ['an unknown environment', { dataCenter: 'staging' }],
    ['a non-GUID integration key', { clientId: 'my-app' }],
    ['an email as the user ID', { username: 'ops@example.com' }],
    ['a non-GUID account ID', { orgId: '12345' }],
    ['a certificate instead of a key', { privateKey: RSA_PUBLIC }],
    [
      'an encrypted key',
      {
        privateKey:
          '-----BEGIN ENCRYPTED PRIVATE KEY-----\nAAAA\n-----END ENCRYPTED PRIVATE KEY-----',
      },
    ],
    [
      'an unreadable PEM',
      { privateKey: '-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----' },
    ],
    ['a non-RSA key', { privateKey: EC_PEM }],
  ])('rejects %s before any request', async (_label, overrides) => {
    await expect(
      mintDocuSignServiceAccountToken({ ...FIELDS, ...overrides })
    ).rejects.toMatchObject({ code: 'invalid_credentials' })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('reports consent_required as its own code', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'consent_required' }, 400))

    await expect(mintDocuSignServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'consent_required',
    })
  })

  it.each([
    ['issuer_not_found', 'integration key not found in this environment'],
    ['user_not_found', 'impersonated user ID not found in this environment'],
    ['no_valid_keys_or_signatures', expect.stringContaining('private key does not match')],
  ])('maps invalid_grant %s to invalid_credentials', async (description, hint) => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ error: 'invalid_grant', error_description: description }, 400)
    )

    await expect(mintDocuSignServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'invalid_credentials',
      logDetail: expect.objectContaining({ hint }),
    })
  })

  it('refuses an RSA key under 2048 bits with copy that says so, before any request', async () => {
    await expect(
      mintDocuSignServiceAccountToken({ ...FIELDS, privateKey: SHORT_RSA_PEM })
    ).rejects.toMatchObject({
      code: 'invalid_credentials',
      logDetail: expect.objectContaining({ reason: expect.stringContaining('1024-bit') }),
    })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it.each([
    [900, 360],
    [300, 240],
  ])(
    'reports a short %ss token so the cache reuses it before, never past, its expiry',
    async (expiresIn, reported) => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ access_token: ACCESS_TOKEN, expires_in: expiresIn }))
        .mockResolvedValueOnce(userinfo(DEMO_ACCOUNTS))

      const result = await mintDocuSignServiceAccountToken(FIELDS)

      expect(result.expiresInSeconds).toBe(reported)
    }
  )

  it.each([429, 503])('treats a %s from the token endpoint as an outage', async (status) => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'busy' }, status))

    await expect(mintDocuSignServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'provider_unavailable',
    })
  })

  it('keeps the key, assertion, and access token out of every failure', async () => {
    const failures: unknown[] = []
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ error: 'invalid_grant', error_description: 'user_not_found' }, 400)
    )
    failures.push(await mintDocuSignServiceAccountToken(FIELDS).catch((error) => error))
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ access_token: ACCESS_TOKEN, expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ error: 'unauthorized' }, 401))
    failures.push(await mintDocuSignServiceAccountToken(FIELDS).catch((error) => error))
    mockMint([])
    failures.push(await mintDocuSignServiceAccountToken(FIELDS).catch((error) => error))
    failures.push(
      await mintDocuSignServiceAccountToken({ ...FIELDS, clientId: 'bad' }).catch((error) => error)
    )

    const assertion = new URLSearchParams(mockFetch.mock.calls[0][1].body as string).get(
      'assertion'
    )
    const keyBody = RSA_PEM.split('\n')[1]
    for (const failure of failures) {
      const text = exposedText(failure)
      expect(text).not.toContain(keyBody)
      expect(text).not.toContain(ACCESS_TOKEN)
      expect(text).not.toContain(String(assertion))
    }
  })
})
