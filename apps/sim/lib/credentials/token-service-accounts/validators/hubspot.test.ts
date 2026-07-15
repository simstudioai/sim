/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { validateHubspotServiceAccount } from '@/lib/credentials/token-service-accounts/validators/hubspot'

const TOKEN_INFO_URL = 'https://api.hubapi.com/oauth/v2/private-apps/get/access-token-info'

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

const mockFetch = vi.fn()

describe('validateHubspotServiceAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns displayName and metadata on success', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url === TOKEN_INFO_URL) {
        return jsonResponse(200, {
          userId: 111,
          hubId: 12345,
          appId: 222,
          scopes: ['tickets'],
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })

    const result = await validateHubspotServiceAccount(FIELDS)

    expect(result).toEqual({
      displayName: 'HubSpot portal 12345',
      auditMetadata: { hubspotHubId: '12345' },
      storedMetadata: { hubId: '12345', appId: '222', userId: '111' },
    })

    const [, init] = mockFetch.mock.calls[0]
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer pat-na1-aaaa-bbbb')
    expect(JSON.parse(init.body)).toEqual({ tokenKey: 'pat-na1-aaaa-bbbb' })
  })

  it('throws invalid_credentials on 401', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(401, { status: 'error', category: 'INVALID_AUTHENTICATION' })
    )

    await expect(validateHubspotServiceAccount(FIELDS)).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'invalid_credentials',
      status: 401,
    })
  })

  it('throws provider_unavailable on 503', async () => {
    mockFetch.mockResolvedValue(jsonResponse(503, { message: 'unavailable' }))

    await expect(validateHubspotServiceAccount(FIELDS)).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'provider_unavailable',
      status: 503,
    })
  })

  it('throws provider_unavailable on malformed success body', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { unexpected: true }))

    await expect(validateHubspotServiceAccount(FIELDS)).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'provider_unavailable',
      status: 502,
    })
  })
})
