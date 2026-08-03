/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { validateWealthboxServiceAccount } from '@/lib/credentials/token-service-accounts/validators/wealthbox'

const ME_URL = 'https://api.crmworkspace.com/v1/me'

const FIELDS = { apiToken: '12345678901234567890123456789012' }

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

describe('validateWealthboxServiceAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns displayName and metadata on Bearer success', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, {
        name: 'Bill Jones',
        email: 'bill@example.com',
        current_user: { id: 42, email: 'bill@example.com', name: 'Bill Jones' },
      })
    )

    const result = await validateWealthboxServiceAccount(FIELDS)

    expect(result).toEqual({
      displayName: 'Bill Jones',
      auditMetadata: { wealthboxUserId: '42' },
      storedMetadata: { userId: '42', email: 'bill@example.com' },
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe(ME_URL)
    expect(init.headers.Authorization).toBe(`Bearer ${FIELDS.apiToken}`)
  })

  it('throws invalid_credentials when Bearer 401s but ACCESS_TOKEN succeeds', async () => {
    mockFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>
      if (headers.Authorization) return jsonResponse(401, { error: 'No valid API key provided' })
      if (headers.ACCESS_TOKEN) return jsonResponse(200, { name: 'Bill Jones' })
      throw new Error('unexpected fetch headers')
    })

    await expect(validateWealthboxServiceAccount(FIELDS)).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'invalid_credentials',
      status: 401,
      logDetail: expect.objectContaining({
        reason: 'token accepted only via ACCESS_TOKEN header — not compatible with Sim tools',
      }),
    })

    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('throws invalid_credentials when both Bearer and ACCESS_TOKEN 401', async () => {
    mockFetch.mockResolvedValue(jsonResponse(401, { error: 'No valid API key provided' }))

    await expect(validateWealthboxServiceAccount(FIELDS)).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'invalid_credentials',
      status: 401,
    })
  })

  it('throws invalid_credentials on 402 (expired Wealthbox trial)', async () => {
    mockFetch.mockResolvedValue(jsonResponse(402, { error: 'Wealthbox trial account has expired' }))

    await expect(validateWealthboxServiceAccount(FIELDS)).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'invalid_credentials',
      status: 402,
      logDetail: { step: 'me', reason: 'wealthbox trial expired (402)' },
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('throws provider_unavailable on 503', async () => {
    mockFetch.mockResolvedValue(jsonResponse(503, { message: 'unavailable' }))

    await expect(validateWealthboxServiceAccount(FIELDS)).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'provider_unavailable',
      status: 503,
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})
