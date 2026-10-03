import { jsonResponse } from '@sim/testing/helpers/http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { validateWealthboxServiceAccount } from '@/lib/credentials/token-service-accounts/validators/wealthbox'

const ME_URL = 'https://api.crmworkspace.com/v1/me'

const FIELDS = { apiToken: '12345678901234567890123456789012' }

const mockFetch = vi.fn()

describe('validateWealthboxServiceAccount', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
  })

  it('probes the me endpoint with a Bearer token', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        name: 'Bill Jones',
        email: 'bill@example.com',
        current_user: { id: 42, email: 'bill@example.com', name: 'Bill Jones' },
      })
    )

    await validateWealthboxServiceAccount(FIELDS)

    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe(ME_URL)
    expect(init.headers.Authorization).toBe(`Bearer ${FIELDS.apiToken}`)
  })

  it('throws invalid_credentials when Bearer 401s but ACCESS_TOKEN succeeds', async () => {
    mockFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>
      if (headers.Authorization) return jsonResponse({ error: 'No valid API key provided' }, 401)
      if (headers.ACCESS_TOKEN) return jsonResponse({ name: 'Bill Jones' })
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

  it('throws invalid_credentials on 402 (expired Wealthbox trial)', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: 'Wealthbox trial account has expired' }, 402))

    await expect(validateWealthboxServiceAccount(FIELDS)).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'invalid_credentials',
      status: 402,
      logDetail: { step: 'me', reason: 'wealthbox trial expired (402)' },
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})
