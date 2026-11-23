import { jsonResponse } from '@sim/testing/helpers/http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { validateHubspotServiceAccount } from '@/lib/credentials/token-service-accounts/validators/hubspot'

const TOKEN_INFO_URL = 'https://api.hubapi.com/oauth/v2/private-apps/get/access-token-info'
const ACCOUNT_INFO_URL = 'https://api.hubapi.com/account-info/v3/details'
const CONTACTS_URL = 'https://api.hubapi.com/crm/v3/objects/contacts?limit=1'

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
    mockFetch.mockReset()
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

  it('throws invalid_credentials when primary 404 and both fallbacks return 401', async () => {
    mockFetch
      .mockResolvedValueOnce(htmlResponse(404, '<html><body>404 Not Found</body></html>'))
      .mockResolvedValueOnce(
        jsonResponse({ status: 'error', category: 'INVALID_AUTHENTICATION' }, 401)
      )
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
      displayName: 'HubSpot',
      principal: null,
      auditMetadata: {},
    })
  })

  it('verifies through account-info a key the token-info route answers with a 401', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({ status: 'error', category: 'INVALID_AUTHENTICATION' }, 401)
      )
      .mockResolvedValueOnce(jsonResponse({ portalId: 456, uiDomain: 'app.hubspot.com' }))

    await expect(validateHubspotServiceAccount(FIELDS)).resolves.toMatchObject({
      displayName: 'HubSpot portal 456',
      principal: { kind: 'tenant', id: '456' },
    })
    expectFallbackCall()
  })

  it('rejects a token token-info answers with a 401 when it is not a pat- key', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({ status: 'error', category: 'INVALID_AUTHENTICATION' }, 401)
      )
      .mockResolvedValueOnce(jsonResponse({ portalId: 456, uiDomain: 'app.hubspot.com' }))

    await expect(
      validateHubspotServiceAccount({ apiToken: 'oauth-access-token' })
    ).rejects.toMatchObject({ code: 'invalid_credentials', status: 401 })
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('verifies through account-info a key token-info answers without a portal', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({ portalId: 789, uiDomain: 'app.hubspot.com' }))

    await expect(validateHubspotServiceAccount(FIELDS)).resolves.toMatchObject({
      displayName: 'HubSpot portal 789',
      principal: { kind: 'tenant', id: '789' },
    })
    expectFallbackCall()
  })

  it('throws invalid_credentials when every route answers 401', async () => {
    const unauthorized = () =>
      jsonResponse({ status: 'error', category: 'INVALID_AUTHENTICATION' }, 401)
    mockFetch
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(unauthorized())

    await expect(validateHubspotServiceAccount(FIELDS)).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'invalid_credentials',
      status: 401,
    })
    const [url, init] = mockFetch.mock.calls[2]
    expect(url).toBe(CONTACTS_URL)
    expect(init.headers.Authorization).toBe('Bearer pat-na1-aaaa-bbbb')
  })

  it.each([
    ['reads contacts', () => jsonResponse({ results: [] })],
    [
      'lacks the contacts scope',
      () => jsonResponse({ status: 'error', category: 'MISSING_SCOPES' }, 403),
    ],
    [
      'lacks the contacts scope, answered with a mixed-case JSON media type',
      () =>
        new Response(JSON.stringify({ status: 'error', category: 'MISSING_SCOPES' }), {
          status: 403,
          headers: { 'Content-Type': 'Application/JSON; charset=UTF-8' },
        }),
    ],
  ])(
    'accepts a service key that account-info refuses but that %s',
    async (_case, contactsAnswer) => {
      mockFetch
        .mockResolvedValueOnce(htmlResponse(404, '<html><body>404 Not Found</body></html>'))
        .mockResolvedValueOnce(
          jsonResponse({ status: 'error', category: 'INVALID_AUTHENTICATION' }, 401)
        )
        .mockResolvedValueOnce(contactsAnswer())

      await expect(validateHubspotServiceAccount(FIELDS)).resolves.toEqual({
        displayName: 'HubSpot',
        principal: null,
        auditMetadata: {},
      })
      expect(mockFetch.mock.calls[2][0]).toBe(CONTACTS_URL)
    }
  )

  it('does not take a firewall 403 page from the contacts read as a live key', async () => {
    mockFetch
      .mockResolvedValueOnce(htmlResponse(404, '<html><body>404 Not Found</body></html>'))
      .mockResolvedValueOnce(
        jsonResponse({ status: 'error', category: 'INVALID_AUTHENTICATION' }, 401)
      )
      .mockResolvedValueOnce(
        new Response('<html>Access denied</html>', {
          status: 403,
          headers: { 'Content-Type': 'text/html' },
        })
      )

    await expect(validateHubspotServiceAccount(FIELDS)).rejects.toMatchObject({
      code: 'invalid_credentials',
    })
  })

  it('reports an outage when the contacts read is unavailable', async () => {
    mockFetch
      .mockResolvedValueOnce(htmlResponse(404, '<html><body>404 Not Found</body></html>'))
      .mockResolvedValueOnce(
        jsonResponse({ status: 'error', category: 'INVALID_AUTHENTICATION' }, 401)
      )
      .mockResolvedValueOnce(jsonResponse({ status: 'error' }, 503))

    await expect(validateHubspotServiceAccount(FIELDS)).rejects.toMatchObject({
      code: 'provider_unavailable',
    })
  })

  it('does not take a firewall 403 page from account-info as a live token', async () => {
    mockFetch
      .mockResolvedValueOnce(htmlResponse(404, '<html><body>404 Not Found</body></html>'))
      .mockResolvedValueOnce(
        new Response('<html>Access denied</html>', {
          status: 403,
          headers: { 'Content-Type': 'text/html' },
        })
      )

    await expect(validateHubspotServiceAccount(FIELDS)).rejects.toMatchObject({
      code: 'invalid_credentials',
    })
  })

  it('reports an outage without the fallback when token-info is unavailable', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ status: 'error' }, 503))

    await expect(validateHubspotServiceAccount(FIELDS)).rejects.toMatchObject({
      code: 'provider_unavailable',
    })
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})
