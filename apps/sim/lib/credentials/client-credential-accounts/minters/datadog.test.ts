import { jsonResponse } from '@sim/testing/helpers/http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mintDatadogServiceAccountToken } from '@/lib/credentials/client-credential-accounts/minters/datadog'

const FIELDS = {
  clientId: 'dd-api-key',
  clientSecret: 'dd-application-key',
  orgId: '',
  dataCenter: 'datadoghq.eu',
}

const mockFetch = vi.fn<typeof fetch>()

describe('Datadog API and application key check', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    vi.stubGlobal('fetch', mockFetch)
  })

  it("validates the API key alone on the site's own API host, never following a redirect", async () => {
    const requests: Request[] = []
    mockFetch.mockImplementation(async (input, init) => {
      requests.push(new Request(input, init))
      return jsonResponse({ valid: true })
    })

    const result = await mintDatadogServiceAccountToken(FIELDS)

    expect(requests).toHaveLength(1)
    const [request] = requests
    expect(request.url).toBe('https://api.datadoghq.eu/api/v1/validate')
    expect(request.method).toBe('GET')
    expect(request.redirect).toBe('error')
    expect(request.headers.get('dd-api-key')).toBe('dd-api-key')
    expect(request.headers.has('dd-application-key')).toBe(false)
    expect(result).toMatchObject({
      accessToken: 'dd-api-key',
      applicationKey: 'dd-application-key',
      domain: 'datadoghq.eu',
    })
    expect(JSON.stringify(result.identity)).not.toContain('dd-api-key')
    expect(JSON.stringify(result.identity)).not.toContain('dd-application-key')
  })

  it('resolves both keys and the site at run time without calling Datadog', async () => {
    const result = await mintDatadogServiceAccountToken(FIELDS, { skipIdentity: true })

    expect(mockFetch).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      accessToken: 'dd-api-key',
      applicationKey: 'dd-application-key',
      domain: 'datadoghq.eu',
    })
  })

  it.each(['', 'datadoghq.co', 'evil.example', 'datadoghq.com@evil.example', 'DATADOGHQ.COM'])(
    'refuses the site %j before sending a key anywhere',
    async (dataCenter) => {
      await expect(mintDatadogServiceAccountToken({ ...FIELDS, dataCenter })).rejects.toMatchObject(
        { code: 'invalid_credentials' }
      )
      await expect(
        mintDatadogServiceAccountToken({ ...FIELDS, dataCenter }, { skipIdentity: true })
      ).rejects.toMatchObject({ code: 'invalid_credentials' })
      expect(mockFetch).not.toHaveBeenCalled()
    }
  )

  it.each([
    ['clientId', 'key\r\nX-Injected: 1'],
    ['clientSecret', 'key\nX-Injected: 1'],
    ['clientSecret', ''],
  ] as const)('refuses an unusable %s before any request', async (field, value) => {
    await expect(
      mintDatadogServiceAccountToken({ ...FIELDS, [field]: value })
    ).rejects.toMatchObject({ code: 'invalid_credentials' })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it.each([
    [403, 'invalid_credentials'],
    [401, 'invalid_credentials'],
    [429, 'provider_unavailable'],
    [500, 'provider_unavailable'],
  ])('maps an HTTP %i validate response to %s', async (status, code) => {
    mockFetch.mockResolvedValue(jsonResponse({ errors: ['Forbidden'] }, { status }))

    await expect(mintDatadogServiceAccountToken(FIELDS)).rejects.toMatchObject({ code })
  })

  it('refuses an API key Datadog does not report as valid', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ valid: false }))

    await expect(mintDatadogServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'invalid_credentials',
    })
  })

  it.each([
    ['no valid field', {}],
    ['a non-boolean valid field', { valid: 'true' }],
  ])('reports a validate answer with %s as a provider fault, not a bad key', async (_, body) => {
    mockFetch.mockResolvedValue(jsonResponse(body))

    await expect(mintDatadogServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'provider_unavailable',
    })
  })
})
