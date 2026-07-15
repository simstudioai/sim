/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { validateHubspotServiceAccount } from '@/lib/credentials/token-service-accounts/validators/hubspot'

const TOKEN_INFO_URL = 'https://api.hubapi.com/oauth/v2/private-apps/get/access-token-info'
const ACCOUNT_INFO_URL = 'https://api.hubapi.com/account-info/v3/details'

const FIELDS = { apiToken: 'pat-na1-aaaa-bbbb' }

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

const mockFetch = vi.fn()

function expectPrimaryCall(): void {
  const [url, init] = mockFetch.mock.calls[0]
  expect(url).toBe(TOKEN_INFO_URL)
  expect(init.method).toBe('POST')
  expect(init.headers.Authorization).toBe('Bearer pat-na1-aaaa-bbbb')
  expect(init.headers['Content-Type']).toBe('application/json')
  expect(JSON.parse(init.body)).toEqual({ tokenKey: 'pat-na1-aaaa-bbbb' })
}

function expectFallbackCall(): void {
  const [url, init] = mockFetch.mock.calls[1]
  expect(url).toBe(ACCOUNT_INFO_URL)
  expect(init.method).toBeUndefined()
  expect(init.headers.Authorization).toBe('Bearer pat-na1-aaaa-bbbb')
  expect(init.headers.Accept).toBe('application/json')
}

describe('validateHubspotServiceAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns displayName and metadata on primary access-token-info success', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, {
        userId: 111,
        hubId: 12345,
        appId: 222,
        scopes: ['tickets'],
      })
    )

    const result = await validateHubspotServiceAccount(FIELDS)

    expect(result).toEqual({
      displayName: 'HubSpot portal 12345',
      auditMetadata: { hubspotHubId: '12345' },
      storedMetadata: { hubId: '12345', appId: '222', userId: '111' },
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expectPrimaryCall()
  })

  it('falls back to account-info on primary 404 and succeeds with portalId', async () => {
    mockFetch
      .mockResolvedValueOnce(htmlResponse(404, '<html><body>404 Not Found</body></html>'))
      .mockResolvedValueOnce(jsonResponse(200, { portalId: 123, uiDomain: 'app.hubspot.com' }))

    const result = await validateHubspotServiceAccount(FIELDS)

    expect(result).toEqual({
      displayName: 'HubSpot portal 123',
      auditMetadata: { hubspotHubId: '123' },
      storedMetadata: { hubId: '123' },
    })

    expect(mockFetch).toHaveBeenCalledTimes(2)
    expectPrimaryCall()
    expectFallbackCall()
  })

  it('throws invalid_credentials when primary 404 and fallback returns 401', async () => {
    mockFetch
      .mockResolvedValueOnce(htmlResponse(404, '<html><body>404 Not Found</body></html>'))
      .mockResolvedValueOnce(
        jsonResponse(401, { status: 'error', category: 'INVALID_AUTHENTICATION' })
      )

    await expect(validateHubspotServiceAccount(FIELDS)).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'invalid_credentials',
      status: 401,
    })

    expect(mockFetch).toHaveBeenCalledTimes(2)
    expectPrimaryCall()
    expectFallbackCall()
  })

  it('treats primary 400 with fallback 403 as a live token without account-info access', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(400, { status: 'error', message: 'bad request' }))
      .mockResolvedValueOnce(jsonResponse(403, { status: 'error', category: 'MISSING_SCOPES' }))

    const result = await validateHubspotServiceAccount(FIELDS)

    expect(result).toEqual({
      displayName: 'HubSpot private app',
      auditMetadata: {},
      storedMetadata: {},
    })

    expect(mockFetch).toHaveBeenCalledTimes(2)
    expectPrimaryCall()
    expectFallbackCall()
  })

  it('throws invalid_credentials on primary 401 without calling the fallback', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(401, { status: 'error', category: 'INVALID_AUTHENTICATION' })
    )

    await expect(validateHubspotServiceAccount(FIELDS)).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'invalid_credentials',
      status: 401,
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('throws provider_unavailable on primary 503', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(503, { message: 'unavailable' }))

    await expect(validateHubspotServiceAccount(FIELDS)).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'provider_unavailable',
      status: 503,
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('throws provider_unavailable on primary success body missing hubId', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { unexpected: true }))

    await expect(validateHubspotServiceAccount(FIELDS)).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'provider_unavailable',
      status: 502,
    })
  })
})
