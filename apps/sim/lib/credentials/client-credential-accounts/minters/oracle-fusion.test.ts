/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSecureFetch, mockValidateUrl } = vi.hoisted(() => ({
  mockSecureFetch: vi.fn(),
  mockValidateUrl: vi.fn(),
}))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  secureFetchWithPinnedIP: mockSecureFetch,
  validateUrlWithDNS: mockValidateUrl,
}))

import { mintOracleFusionServiceAccountToken } from '@/lib/credentials/client-credential-accounts/minters/oracle-fusion'

const INSTANCE_URL = 'https://vision.fa.us2.oraclecloud.com'
const TOKEN_URL = 'https://idcs-abc.identity.oraclecloud.com/oauth2/v1/token'
const FIELDS = {
  orgId: '',
  instanceUrl: INSTANCE_URL,
  tokenUrl: TOKEN_URL,
  clientId: 'oracle-client-id',
  clientSecret: 'oracle-client-secret',
  scope: 'urn:opc:resource:fa:scope urn:opc:resource:consumer::all',
}

function response(status: number, body: unknown, headers: Record<string, string> = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    body: null,
    text: async () => text,
    json: async () => JSON.parse(text),
    arrayBuffer: async () => new TextEncoder().encode(text).buffer,
  }
}

describe('mintOracleFusionServiceAccountToken', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockValidateUrl.mockResolvedValue({
      isValid: true,
      resolvedIP: '203.0.113.10',
      originalHostname: 'oracle.example',
    })
    mockSecureFetch.mockResolvedValue(
      response(200, { access_token: 'oracle-access', expires_in: 1800, token_type: 'Bearer' })
    )
  })

  afterEach(() => vi.restoreAllMocks())

  it('uses Basic client authentication and the documented client_credentials form', async () => {
    const result = await mintOracleFusionServiceAccountToken(FIELDS)

    expect(mockValidateUrl).toHaveBeenNthCalledWith(
      1,
      INSTANCE_URL,
      'Fusion Applications URL',
      'configuredEndpoint'
    )
    expect(mockValidateUrl).toHaveBeenNthCalledWith(
      2,
      TOKEN_URL,
      'Access token URL',
      'configuredEndpoint'
    )
    const [url, resolvedIP, init] = mockSecureFetch.mock.calls[0]
    expect(url).toBe(TOKEN_URL)
    expect(resolvedIP).toBe('203.0.113.10')
    expect(init).toMatchObject({
      profile: 'configuredEndpoint',
      method: 'POST',
      maxRedirects: 0,
      maxResponseBytes: 1024 * 1024,
      timeout: 30_000,
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${Buffer.from('oracle-client-id:oracle-client-secret').toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
    })
    expect(new URLSearchParams(init.body)).toEqual(
      new URLSearchParams({ grant_type: 'client_credentials', scope: FIELDS.scope })
    )
    expect(result).toEqual({
      accessToken: 'oracle-access',
      expiresInSeconds: 1800,
      instanceUrl: INSTANCE_URL,
      identity: {
        displayName: 'Oracle Fusion Cloud Financials vision',
        principal: {
          kind: 'tenant',
          id: 'vision.fa.us2.oraclecloud.com',
          label: 'vision.fa.us2.oraclecloud.com',
        },
        auditMetadata: { oracleFusionApplicationOrigin: INSTANCE_URL },
        storedMetadata: {
          applicationOrigin: INSTANCE_URL,
          identityDomainHost: 'idcs-abc.identity.oraclecloud.com',
        },
      },
    })
  })

  it('normalizes supported OCS hosts and omits connect-time identity during token resolution', async () => {
    await expect(
      mintOracleFusionServiceAccountToken(
        { ...FIELDS, instanceUrl: ' HTTPS://VISION.FA.OCS.ORACLECLOUD.COM/ ' },
        { skipIdentity: true }
      )
    ).resolves.toEqual({
      accessToken: 'oracle-access',
      expiresInSeconds: 1800,
      instanceUrl: 'https://vision.fa.ocs.oraclecloud.com',
    })
  })

  it.each([
    'http://vision.fa.us2.oraclecloud.com',
    'https://vision.fa.us2.oraclecloud.com/path',
    'https://vision.fa.us2.oraclecloud.com:443',
    'https://vision.fa.us2.oraclecloud.com:444',
    'https://user@vision.fa.us2.oraclecloud.com',
    'https://vision.fa.us2.oraclecloud.com?tenant=other',
    'https://vision.fa.us2.oraclecloud.com.evil.example',
    'https://vanity.example.com',
  ])(
    'rejects the noncanonical Fusion application URL %j before DNS or fetch',
    async (instanceUrl) => {
      await expect(
        mintOracleFusionServiceAccountToken({ ...FIELDS, instanceUrl })
      ).rejects.toMatchObject({ code: 'site_not_found', status: 400 })
      expect(mockValidateUrl).not.toHaveBeenCalled()
      expect(mockSecureFetch).not.toHaveBeenCalled()
    }
  )

  it.each([
    'http://idcs-abc.identity.oraclecloud.com/oauth2/v1/token',
    'https://idcs-abc.identity.oraclecloud.com/oauth2/v1/token/extra',
    'https://idcs-abc.identity.oraclecloud.com/oauth2/v1/token?scope=other',
    'https://user@idcs-abc.identity.oraclecloud.com/oauth2/v1/token',
    'https://idcs-abc.identity.oraclecloud.com:443/oauth2/v1/token',
    'https://idcs-abc.identity.oraclecloud.com:444/oauth2/v1/token',
    'https://identity.oraclecloud.com/oauth2/v1/token',
    'https://idcs-abc.identity.oraclecloud.com.evil.example/oauth2/v1/token',
  ])('rejects the noncanonical token URL %j before DNS or fetch', async (tokenUrl) => {
    await expect(
      mintOracleFusionServiceAccountToken({ ...FIELDS, tokenUrl })
    ).rejects.toMatchObject({ code: 'site_not_found', status: 400 })
    expect(mockValidateUrl).not.toHaveBeenCalled()
    expect(mockSecureFetch).not.toHaveBeenCalled()
  })

  it('rejects a DNS result blocked by the shared SSRF policy', async () => {
    mockValidateUrl.mockResolvedValueOnce({
      isValid: false,
      error: 'resolves to a private address',
    })

    await expect(mintOracleFusionServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'site_not_found',
      status: 400,
    })
    expect(mockSecureFetch).not.toHaveBeenCalled()
  })

  it.each([
    [400, 'invalid_credentials'],
    [401, 'invalid_credentials'],
    [429, 'provider_unavailable'],
    [503, 'provider_unavailable'],
  ] as const)('classifies HTTP %i as %s and redacts reflected inputs', async (status, code) => {
    mockSecureFetch.mockResolvedValueOnce(
      response(status, {
        title: `${FIELDS.clientId} ${FIELDS.clientSecret}`,
        detail: FIELDS.scope,
      })
    )

    const error = await mintOracleFusionServiceAccountToken(FIELDS).catch((caught) => caught)
    expect(error).toMatchObject({ code, status })
    const serialized = JSON.stringify((error as { logDetail?: unknown }).logDetail)
    expect(serialized).not.toContain(FIELDS.clientId)
    expect(serialized).not.toContain(FIELDS.clientSecret)
    expect(serialized).not.toContain(FIELDS.scope)
  })

  it.each([
    [{ access_token: 'token', expires_in: 3600 }, 'missing bearer token_type'],
    [{ access_token: 'token', expires_in: '3600', token_type: 'Bearer' }, 'expires_in'],
    [{ access_token: '', expires_in: 3600, token_type: 'Bearer' }, 'access_token'],
    ['not-json', 'non-JSON'],
  ])('rejects malformed token payload %# (%s)', async (body) => {
    mockSecureFetch.mockResolvedValueOnce(response(200, body))
    await expect(mintOracleFusionServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'provider_unavailable',
      status: 502,
    })
  })

  it('caps token lifetime and propagates caller cancellation', async () => {
    mockSecureFetch.mockResolvedValueOnce(
      response(200, { access_token: 'oracle-access', expires_in: 7200, token_type: 'bearer' })
    )
    await expect(
      mintOracleFusionServiceAccountToken(FIELDS, { skipIdentity: true })
    ).resolves.toMatchObject({ expiresInSeconds: 3600 })

    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))
    await expect(
      mintOracleFusionServiceAccountToken(FIELDS, { signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('rejects network failures and redirects without exposing their details', async () => {
    mockSecureFetch.mockRejectedValueOnce(new Error(`redirected with ${FIELDS.clientSecret}`))
    await expect(mintOracleFusionServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'provider_unavailable',
      status: 502,
      logDetail: {
        step: 'oracle_fusion_token_mint',
        reason: 'network error reaching token endpoint',
      },
    })
  })
})
