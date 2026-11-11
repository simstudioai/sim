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

  it("posts the client credentials to the selected cloud's token endpoint and never follows a redirect", async () => {
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
    expect(request.redirect).toBe('error')
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

  it('treats a redirect from the token endpoint as a provider failure, not a followed hop', async () => {
    mockFetch.mockRejectedValue(new TypeError('fetch failed: unexpected redirect'))

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
