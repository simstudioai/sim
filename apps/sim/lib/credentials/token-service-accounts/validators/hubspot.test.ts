import { jsonResponse } from '@sim/testing/helpers/http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { validateHubspotServiceAccount } from '@/lib/credentials/token-service-accounts/validators/hubspot'

const TOKEN_INFO_URL = 'https://api.hubapi.com/oauth/v2/private-apps/get/access-token-info'
const ACCOUNT_INFO_URL = 'https://api.hubapi.com/account-info/v3/details'

const FIELDS = { apiToken: 'pat-na1-aaaa-bbbb' }

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
    vi.stubGlobal('fetch', mockFetch)
  })

  it('falls back to account-info on primary 404 and succeeds with portalId', async () => {
    mockFetch
      .mockResolvedValueOnce(htmlResponse(404, '<html><body>404 Not Found</body></html>'))
      .mockResolvedValueOnce(jsonResponse({ portalId: 123, uiDomain: 'app.hubspot.com' }))

    const result = await validateHubspotServiceAccount(FIELDS)

    expect(result).toEqual({
      displayName: 'HubSpot portal 123',
      principal: { kind: 'tenant', id: '123' },
      auditMetadata: {},
    })

    expectPrimaryCall()
    expectFallbackCall()
  })

  it('throws invalid_credentials when primary 404 and fallback returns 401', async () => {
    mockFetch
      .mockResolvedValueOnce(htmlResponse(404, '<html><body>404 Not Found</body></html>'))
      .mockResolvedValueOnce(
        jsonResponse({ status: 'error', category: 'INVALID_AUTHENTICATION' }, 401)
      )

    await expect(validateHubspotServiceAccount(FIELDS)).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'invalid_credentials',
      status: 401,
    })
  })

  it('treats primary 400 with fallback 403 as a live token without account-info access', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ status: 'error', message: 'bad request' }, 400))
      .mockResolvedValueOnce(jsonResponse({ status: 'error', category: 'MISSING_SCOPES' }, 403))

    const result = await validateHubspotServiceAccount(FIELDS)

    expect(result).toEqual({
      displayName: 'HubSpot private app',
      principal: null,
      auditMetadata: {},
    })
  })

  it('throws invalid_credentials on primary 401 without calling the fallback', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ status: 'error', category: 'INVALID_AUTHENTICATION' }, 401)
    )

    await expect(validateHubspotServiceAccount(FIELDS)).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'invalid_credentials',
      status: 401,
    })
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})
