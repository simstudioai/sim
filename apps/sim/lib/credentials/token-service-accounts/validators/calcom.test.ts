/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TokenServiceAccountValidationError } from '@/lib/credentials/token-service-accounts/errors'
import { validateCalcomServiceAccount } from '@/lib/credentials/token-service-accounts/validators/calcom'

const mockFetch = vi.fn()

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('validateCalcomServiceAccount', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    mockFetch.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns display name and metadata on success', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, {
        status: 'success',
        data: { id: 42, username: 'sim-bot', email: 'bot@example.com' },
      })
    )

    const result = await validateCalcomServiceAccount({ apiToken: 'cal_live_token' })

    expect(result).toEqual({
      displayName: 'sim-bot',
      auditMetadata: { calcomUserId: '42' },
      storedMetadata: { userId: '42', email: 'bot@example.com' },
    })
    expect(mockFetch).toHaveBeenCalledWith('https://api.cal.com/v2/me', {
      headers: {
        Authorization: 'Bearer cal_live_token',
        Accept: 'application/json',
      },
    })
  })

  it('maps 401 to invalid_credentials', async () => {
    mockFetch.mockResolvedValue(jsonResponse(401, { status: 'error' }))

    const error = await validateCalcomServiceAccount({ apiToken: 'cal_bad' }).catch((e) => e)

    expect(error).toBeInstanceOf(TokenServiceAccountValidationError)
    expect(error.code).toBe('invalid_credentials')
    expect(error.status).toBe(401)
  })

  it('maps 500 to provider_unavailable', async () => {
    mockFetch.mockResolvedValue(jsonResponse(500, { message: 'Server error' }))

    const error = await validateCalcomServiceAccount({ apiToken: 'cal_token' }).catch((e) => e)

    expect(error).toBeInstanceOf(TokenServiceAccountValidationError)
    expect(error.code).toBe('provider_unavailable')
    expect(error.status).toBe(500)
  })

  it('maps a 200 response with a non-success envelope to provider_unavailable', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { status: 'error', data: { id: 42 } }))

    const error = await validateCalcomServiceAccount({ apiToken: 'cal_token' }).catch((e) => e)

    expect(error).toBeInstanceOf(TokenServiceAccountValidationError)
    expect(error.code).toBe('provider_unavailable')
    expect(error.status).toBe(502)
  })
})
