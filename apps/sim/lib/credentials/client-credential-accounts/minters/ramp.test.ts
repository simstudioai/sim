import { jsonResponse } from '@sim/testing/helpers/http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mintRampServiceAccountToken } from '@/lib/credentials/client-credential-accounts/minters/ramp'

const FIELDS = { clientId: 'ramp-client', clientSecret: 'ramp-secret', orgId: '' }
const SCOPES =
  'business:read users:read transactions:read cards:read vendors:read bills:read reimbursements:read memos:read memos:write'
const TOKEN = {
  access_token: 'ramp-access',
  token_type: 'Bearer',
  expires_in: 864000,
  scope: SCOPES,
}

const mockFetch = vi.fn<typeof fetch>()

describe('Ramp client credential exchange', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    vi.stubGlobal('fetch', mockFetch)
  })

  it('exchanges app credentials for scoped access and binds the connected business identity', async () => {
    const requests: Request[] = []
    mockFetch.mockImplementation(async (input, init) => {
      const request = new Request(input, init)
      requests.push(request)
      if (request.url === 'https://api.ramp.com/developer/v1/token') {
        expect(request.method).toBe('POST')
        expect(request.redirect).toBe('error')
        const [scheme, encodedCredentials = ''] = (
          request.headers.get('authorization') ?? ''
        ).split(' ')
        expect(scheme).toBe('Basic')
        expect(Buffer.from(encodedCredentials, 'base64').toString('utf8')).toBe(
          'ramp-client:ramp-secret'
        )
        expect(request.headers.get('content-type')).toBe('application/x-www-form-urlencoded')
        const body = new URLSearchParams(await request.text())
        expect(body.get('grant_type')).toBe('client_credentials')
        expect(new Set(body.get('scope')?.split(' '))).toEqual(new Set(SCOPES.split(' ')))
        expect(body.has('client_secret')).toBe(false)
        expect(body.has('org_id')).toBe(false)
        return jsonResponse(TOKEN)
      }
      expect(request.url).toBe('https://api.ramp.com/developer/v1/business')
      expect(request.redirect).toBe('error')
      expect(request.headers.get('authorization')).toBe('Bearer ramp-access')
      return jsonResponse({ id: 'business-1', business_name_legal: 'Example Business' })
    })

    const result = await mintRampServiceAccountToken({
      ...FIELDS,
      orgId: 'https://attacker.invalid',
      dataCenter: 'https://attacker.invalid',
    })

    expect(result.accessToken).toBe('ramp-access')
    expect(result.expiresInSeconds).toBe(864000)
    expect(result.grantedScopes).toEqual(SCOPES.split(' '))
    expect(result.identity).toMatchObject({
      displayName: 'Example Business',
      principal: { kind: 'tenant', id: 'business-1' },
    })
    expect(requests).toHaveLength(2)
    expect(JSON.stringify(result.identity)).not.toContain(FIELDS.clientSecret)
    expect(JSON.stringify(result.identity)).not.toContain(TOKEN.access_token)
  })

  it('renews using the reported lifetime without requiring a business lookup', async () => {
    mockFetch.mockImplementation(async (input) => {
      expect(String(input)).toBe('https://api.ramp.com/developer/v1/token')
      return jsonResponse({ ...TOKEN, expires_in: 73 })
    })

    const result = await mintRampServiceAccountToken(FIELDS, { skipIdentity: true })

    expect(result.expiresInSeconds).toBe(73)
    expect(result.identity).toBeUndefined()
  })

  it.each([0, -1, '864000', null, undefined, 1.5])(
    'rejects an unusable token lifetime (%s)',
    async (expiresIn) => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ ...TOKEN, expires_in: expiresIn }))

      await expect(
        mintRampServiceAccountToken(FIELDS, { skipIdentity: true })
      ).rejects.toMatchObject({ code: 'provider_unavailable', status: 502 })
    }
  )

  it.each(['', undefined, 42])(
    'rejects a missing or malformed bearer token (%s)',
    async (token) => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ ...TOKEN, access_token: token }))

      await expect(
        mintRampServiceAccountToken(FIELDS, { skipIdentity: true })
      ).rejects.toMatchObject({
        code: 'provider_unavailable',
        status: 502,
      })
    }
  )

  it.each([400, 401, 403, 408, 429, 500])(
    'classifies provider failure %s without retaining its secret-bearing body',
    async (status) => {
      const reflectedSecret = `${FIELDS.clientSecret}:${TOKEN.access_token}`
      mockFetch.mockResolvedValueOnce(jsonResponse({ error: reflectedSecret }, status))

      const failure = await mintRampServiceAccountToken(FIELDS, { skipIdentity: true }).catch(
        (error: unknown) => error
      )

      expect(failure).toMatchObject({
        code: [400, 401, 403].includes(status) ? 'invalid_credentials' : 'provider_unavailable',
        status,
      })
      expect(JSON.stringify(failure)).not.toContain(FIELDS.clientSecret)
      expect(JSON.stringify(failure)).not.toContain(TOKEN.access_token)
    }
  )

  it.each(['token', 'business'])('bounds the %s response before parsing JSON', async (step) => {
    if (step === 'business') mockFetch.mockResolvedValueOnce(jsonResponse(TOKEN))
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ ...TOKEN, id: 'business-1', extra: 'x'.repeat(64 * 1024) })
    )

    await expect(mintRampServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'provider_unavailable',
      status: 502,
    })
  })

  it.each(['token', 'business'])(
    'rejects malformed %s JSON as a provider failure',
    async (step) => {
      if (step === 'business') mockFetch.mockResolvedValueOnce(jsonResponse(TOKEN))
      mockFetch.mockResolvedValueOnce(new Response('<html>gateway error</html>'))

      await expect(mintRampServiceAccountToken(FIELDS)).rejects.toMatchObject({
        code: 'provider_unavailable',
        status: 502,
      })
    }
  )

  it('does not connect a business without a stable identity', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(TOKEN))
      .mockResolvedValueOnce(jsonResponse({ business_name_legal: 'Example Business' }))

    await expect(mintRampServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'provider_unavailable',
      status: 502,
    })
  })

  it('rejects a business access denial rather than saving an unverified connection', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(TOKEN))
      .mockResolvedValueOnce(jsonResponse({ error: FIELDS.clientSecret }, 403))

    const failure = await mintRampServiceAccountToken(FIELDS).catch((error: unknown) => error)

    expect(failure).toMatchObject({ code: 'invalid_credentials', status: 403 })
    expect(JSON.stringify(failure)).not.toContain(FIELDS.clientSecret)
  })
})
