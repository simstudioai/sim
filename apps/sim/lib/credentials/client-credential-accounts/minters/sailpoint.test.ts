import { jsonResponse } from '@sim/testing/helpers/http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mintSailPointServiceAccountToken } from '@/lib/credentials/client-credential-accounts/minters/sailpoint'

const FIELDS = { clientId: 'sp-client', clientSecret: 'sp-secret', orgId: 'acme' }

const mockFetch = vi.fn<typeof fetch>()

describe('SailPoint API client token exchange', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    vi.stubGlobal('fetch', mockFetch)
  })

  it("posts the client credentials to the tenant's documented token endpoint and never follows a redirect", async () => {
    const requests: Request[] = []
    mockFetch.mockImplementation(async (input, init) => {
      requests.push(new Request(input, init))
      return jsonResponse({ access_token: 'sp-access', expires_in: 749 })
    })

    const result = await mintSailPointServiceAccountToken(FIELDS)

    expect(requests).toHaveLength(1)
    const [request] = requests
    expect(request.url).toBe('https://acme.api.identitynow.com/oauth/token')
    expect(request.method).toBe('POST')
    expect(request.redirect).toBe('error')
    expect(Object.fromEntries(new URLSearchParams(await request.text()))).toEqual({
      grant_type: 'client_credentials',
      client_id: 'sp-client',
      client_secret: 'sp-secret',
    })
    expect(result).toMatchObject({
      accessToken: 'sp-access',
      expiresInSeconds: 749,
      domain: 'acme.api.identitynow.com',
    })
    expect(JSON.stringify(result.identity)).not.toContain('sp-secret')
    expect(JSON.stringify(result.identity)).not.toContain('sp-access')
  })

  it.each([
    'acme.api.identitynow.com',
    'https://acme.api.identitynow.com/',
    'https://acme.identitynow.com/ui/d/dashboard',
    ' ACME ',
  ])('mints for the tenant typed as %j at its API host', async (orgId) => {
    mockFetch.mockResolvedValue(jsonResponse({ access_token: 'sp-access', expires_in: 749 }))

    const result = await mintSailPointServiceAccountToken({ ...FIELDS, orgId })

    expect(mockFetch.mock.calls[0]?.[0]).toBe('https://acme.api.identitynow.com/oauth/token')
    expect(result.domain).toBe('acme.api.identitynow.com')
  })

  it('mints for a government tenant at its identitynowgov.com API host', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ access_token: 'sp-access', expires_in: 749 }))

    const result = await mintSailPointServiceAccountToken({
      ...FIELDS,
      orgId: 'https://agency.api.identitynowgov.com/',
    })

    expect(mockFetch.mock.calls[0]?.[0]).toBe('https://agency.api.identitynowgov.com/oauth/token')
    expect(result.domain).toBe('agency.api.identitynowgov.com')
    expect(result.identity?.displayName).toBe('SailPoint agency')
  })

  it.each([
    '',
    'evil.example',
    'acme.api.identitynow.com.evil.example',
    'acme.api.identitynow.com@evil.example',
    'https://user:pass@acme.api.identitynow.com',
    'https://acme.api.identitynow.com:8443',
    'http://acme.api.identitynow.com',
    'a.b.api.identitynow.com',
    'acme.identitynowgov.com',
    'api',
    'api.identitynow.com',
    'https://api.identitynow.com/',
    'api.api.identitynow.com',
  ])('refuses the tenant %j before sending the secret anywhere', async (orgId) => {
    await expect(mintSailPointServiceAccountToken({ ...FIELDS, orgId })).rejects.toMatchObject({
      code: 'invalid_credentials',
    })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it.each([
    [400, 'invalid_credentials'],
    [401, 'invalid_credentials'],
    [403, 'invalid_credentials'],
    [500, 'provider_unavailable'],
    [503, 'provider_unavailable'],
  ])('maps an HTTP %i token response to %s', async (status, code) => {
    mockFetch.mockResolvedValue(
      jsonResponse({ error: 'invalid_client', error_description: 'Bad credentials' }, { status })
    )

    await expect(mintSailPointServiceAccountToken(FIELDS)).rejects.toMatchObject({ code })
  })

  it('treats a network failure or refused redirect as a provider failure', async () => {
    mockFetch.mockRejectedValue(new TypeError('fetch failed: unexpected redirect'))

    await expect(mintSailPointServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'provider_unavailable',
    })
  })

  it('reports a tenant whose host does not resolve as a wrong tenant, not an outage', async () => {
    mockFetch.mockRejectedValue(
      new TypeError('fetch failed', {
        cause: Object.assign(new Error('getaddrinfo'), { code: 'ENOTFOUND' }),
      })
    )

    await expect(mintSailPointServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'site_not_found',
      status: 400,
    })
  })

  it('keeps a transient DNS failure a provider failure', async () => {
    mockFetch.mockRejectedValue(
      new TypeError('fetch failed', {
        cause: Object.assign(new Error('getaddrinfo'), { code: 'EAI_AGAIN' }),
      })
    )

    await expect(mintSailPointServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'provider_unavailable',
    })
  })

  it('refuses a token response without an access token', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ expires_in: 749 }))

    await expect(mintSailPointServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'provider_unavailable',
    })
  })

  it("keeps a caller's cancellation as a cancellation", async () => {
    const controller = new AbortController()
    const reason = new DOMException('Workflow cancelled', 'AbortError')
    controller.abort(reason)

    await expect(
      mintSailPointServiceAccountToken(FIELDS, { signal: controller.signal })
    ).rejects.toBe(reason)
  })
})
