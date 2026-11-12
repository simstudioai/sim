import { jsonResponse } from '@sim/testing/helpers/http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mintCrowdStrikeServiceAccountToken } from '@/lib/credentials/client-credential-accounts/minters/crowdstrike'

const FIELDS = {
  clientId: 'falcon-client',
  clientSecret: 'falcon-secret',
  orgId: '',
  dataCenter: 'eu-1',
}

const mockFetch = vi.fn<typeof fetch>()

describe('CrowdStrike API client token exchange', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    vi.stubGlobal('fetch', mockFetch)
  })

  it("posts the client credentials to the selected cloud's token endpoint without following redirects", async () => {
    const requests: Request[] = []
    mockFetch.mockImplementation(async (input, init) => {
      const request = new Request(input, init)
      requests.push(request)
      return jsonResponse({ access_token: 'falcon-access', expires_in: 1799 })
    })

    const result = await mintCrowdStrikeServiceAccountToken(FIELDS)

    expect(requests).toHaveLength(1)
    const [request] = requests
    expect(request.url).toBe('https://api.eu-1.crowdstrike.com/oauth2/token')
    expect(request.method).toBe('POST')
    expect(request.redirect).toBe('manual')
    expect(request.headers.get('content-type')).toBe('application/x-www-form-urlencoded')
    expect(Object.fromEntries(new URLSearchParams(await request.text()))).toEqual({
      grant_type: 'client_credentials',
      client_id: 'falcon-client',
      client_secret: 'falcon-secret',
    })
    expect(result).toMatchObject({
      accessToken: 'falcon-access',
      expiresInSeconds: 1799,
      domain: 'eu-1',
    })
    expect(JSON.stringify(result.identity)).not.toContain('falcon-secret')
    expect(JSON.stringify(result.identity)).not.toContain('falcon-access')
  })

  it('locks the token to the member CID an MSSP parent names', async () => {
    let body = ''
    mockFetch.mockImplementation(async (input, init) => {
      body = await new Request(input, init).text()
      return jsonResponse({ access_token: 'falcon-access', expires_in: 1799 })
    })

    const result = await mintCrowdStrikeServiceAccountToken({ ...FIELDS, orgId: ' child-cid ' })

    expect(new URLSearchParams(body).get('member_cid')).toBe('child-cid')
    expect(result.identity?.auditMetadata).toMatchObject({ crowdstrikeMemberCid: 'child-cid' })
  })

  it.each(['', 'us-4', 'api.crowdstrike.com', 'https://evil.example'])(
    'refuses the cloud %j before sending the secret anywhere',
    async (dataCenter) => {
      await expect(
        mintCrowdStrikeServiceAccountToken({ ...FIELDS, dataCenter })
      ).rejects.toMatchObject({ code: 'invalid_credentials' })
      expect(mockFetch).not.toHaveBeenCalled()
    }
  )

  it.each([
    [400, 'invalid_credentials'],
    [401, 'invalid_credentials'],
    [403, 'invalid_credentials'],
    [429, 'provider_unavailable'],
    [503, 'provider_unavailable'],
  ])('maps an HTTP %i token response to %s', async (status, code) => {
    mockFetch.mockResolvedValue(
      jsonResponse({ errors: [{ code: status, message: 'access denied' }] }, { status })
    )

    await expect(mintCrowdStrikeServiceAccountToken(FIELDS)).rejects.toMatchObject({ code })
  })

  it("carries the token endpoint's Retry-After on a throttled answer", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(
        { errors: [{ code: 429, message: 'rate limited' }] },
        { status: 429, headers: { 'Retry-After': '7' } }
      )
    )

    await expect(mintCrowdStrikeServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'provider_unavailable',
      retryAfterMs: 7_000,
    })
  })

  it("keeps a throttled answer's status and Retry-After when its error body cannot be read", async () => {
    mockFetch.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new TypeError('terminated'))
          },
        }),
        { status: 429, headers: { 'Retry-After': '7' } }
      )
    )

    await expect(mintCrowdStrikeServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'provider_unavailable',
      status: 429,
      retryAfterMs: 7_000,
    })
  })

  it("reports a redirect to the API client's own cloud as a wrong cloud and never follows it", async () => {
    mockFetch.mockResolvedValue(
      new Response(null, {
        status: 308,
        headers: {
          Location: 'https://api.us-2.crowdstrike.com/oauth2/token',
          'X-Cs-Region': 'us-2',
        },
      })
    )

    const error = await mintCrowdStrikeServiceAccountToken(FIELDS).catch((caught) => caught)

    expect(error).toMatchObject({
      code: 'invalid_credentials',
      status: 400,
      logDetail: { cloud: 'eu-1', apiClientCloud: 'us-2' },
    })
    expect(JSON.stringify(error.logDetail)).not.toContain('https://')
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('reports any other redirect from the token endpoint as a wrong cloud without naming one', async () => {
    mockFetch.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: 'https://evil.example/oauth2/token', 'X-Cs-Region': 'evil.example' },
      })
    )

    const error = await mintCrowdStrikeServiceAccountToken(FIELDS).catch((caught) => caught)

    expect(error).toMatchObject({ code: 'invalid_credentials', status: 400 })
    expect(JSON.stringify(error.logDetail)).not.toContain('evil.example')
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('treats a network failure reaching the token endpoint as a provider failure', async () => {
    mockFetch.mockRejectedValue(new TypeError('fetch failed'))

    await expect(mintCrowdStrikeServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'provider_unavailable',
    })
  })

  it('refuses a token response without an access token', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ expires_in: 1799 }))

    await expect(mintCrowdStrikeServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'provider_unavailable',
    })
  })

  it('falls back to the documented 30-minute lifetime when expires_in is unusable', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ access_token: 'falcon-access', expires_in: 'soon' }))

    await expect(mintCrowdStrikeServiceAccountToken(FIELDS)).resolves.toMatchObject({
      expiresInSeconds: 1800,
    })
  })
})
