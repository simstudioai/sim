/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { validatePipedriveServiceAccount } from '@/lib/credentials/token-service-accounts/validators/pipedrive'

const ME_URL = 'https://api.pipedrive.com/v1/users/me'

const FIELDS = { apiToken: 'pd-test-token' }

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

describe('validatePipedriveServiceAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns displayName and metadata on success using the x-api-token header', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, {
        success: true,
        data: {
          id: 42,
          name: 'Jane Doe',
          company_id: 777,
          company_name: 'Acme Inc',
          company_domain: 'acme',
        },
      })
    )

    const result = await validatePipedriveServiceAccount(FIELDS)

    expect(result).toEqual({
      displayName: 'Jane Doe (Acme Inc)',
      auditMetadata: { pipedriveCompanyId: '777' },
      storedMetadata: { userId: '42', companyId: '777', companyDomain: 'acme' },
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe(ME_URL)
    expect(init.headers['x-api-token']).toBe(FIELDS.apiToken)
    expect(init.headers.Authorization).toBeUndefined()
  })

  it('falls back to a company display name when the user name is missing', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, { success: true, data: { id: 42, company_id: 777 } })
    )

    const result = await validatePipedriveServiceAccount(FIELDS)

    expect(result.displayName).toBe('Pipedrive company 777')
    expect(result.storedMetadata).toEqual({ userId: '42', companyId: '777' })
  })

  it('throws invalid_credentials on 401', async () => {
    mockFetch.mockResolvedValue(jsonResponse(401, {}))

    await expect(validatePipedriveServiceAccount(FIELDS)).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'invalid_credentials',
      status: 401,
    })
  })

  it('throws provider_unavailable on 429 (rate limited, token not blamed)', async () => {
    mockFetch.mockResolvedValue(jsonResponse(429, { error: 'Rate limit exceeded' }))

    await expect(validatePipedriveServiceAccount(FIELDS)).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'provider_unavailable',
      status: 429,
    })
  })

  it('throws provider_unavailable on 503', async () => {
    mockFetch.mockResolvedValue(jsonResponse(503, { message: 'unavailable' }))

    await expect(validatePipedriveServiceAccount(FIELDS)).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'provider_unavailable',
      status: 503,
    })
  })

  it('throws provider_unavailable on a non-JSON response body', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: '',
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON')
      },
      text: async () => '<html>proxy error</html>',
    } as unknown as Response)

    await expect(validatePipedriveServiceAccount(FIELDS)).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'provider_unavailable',
      status: 502,
    })
  })

  it('throws provider_unavailable when the response lacks a user id', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { success: true, data: {} }))

    await expect(validatePipedriveServiceAccount(FIELDS)).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'provider_unavailable',
      status: 502,
      logDetail: { step: 'users_me', reason: 'missing user id' },
    })
  })

  it('throws provider_unavailable on a network error', async () => {
    mockFetch.mockRejectedValue(new TypeError('fetch failed'))

    await expect(validatePipedriveServiceAccount(FIELDS)).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'provider_unavailable',
      status: 502,
      logDetail: { step: 'users_me', reason: 'network error reaching provider' },
    })
  })
})
