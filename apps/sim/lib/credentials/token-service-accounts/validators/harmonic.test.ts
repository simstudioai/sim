import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TokenServiceAccountValidationError } from '@/lib/credentials/token-service-accounts/errors'
import { validateHarmonicServiceAccount } from '@/lib/credentials/token-service-accounts/validators/harmonic'

const mockFetch = vi.fn()
const API_KEY = 'harmonic-team-key-abcdefghijklmnop'

async function expectValidationError(
  promise: Promise<unknown>,
  code: 'invalid_credentials' | 'provider_unavailable'
): Promise<TokenServiceAccountValidationError> {
  const error = await promise.then(
    () => {
      throw new Error('expected validation to throw')
    },
    (cause: unknown) => cause
  )
  expect(error).toBeInstanceOf(TokenServiceAccountValidationError)
  expect((error as TokenServiceAccountValidationError).code).toBe(code)
  return error as TokenServiceAccountValidationError
}

describe('validateHarmonicServiceAccount', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
  })

  it('validates with the fixed saved-search endpoint and cancels the unread body', async () => {
    const response = new Response('{not-json', { status: 200 })
    const cancel = vi.spyOn(response.body!, 'cancel')
    mockFetch.mockResolvedValue(response)

    await validateHarmonicServiceAccount({ apiToken: API_KEY })

    expect(mockFetch).toHaveBeenCalledWith('https://api.harmonic.ai/savedSearches', {
      headers: {
        apikey: API_KEY,
        Accept: 'application/json',
      },
      redirect: 'error',
      signal: expect.any(AbortSignal),
    })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it.each([401])('maps HTTP %i to invalid_credentials', async (status) => {
    const response = new Response(`denied ${API_KEY}`, { status })
    const cancel = vi.spyOn(response.body!, 'cancel')
    mockFetch.mockResolvedValue(response)

    const error = await expectValidationError(
      validateHarmonicServiceAccount({ apiToken: API_KEY }),
      'invalid_credentials'
    )

    expect(error.status).toBe(status)
    expect(cancel).toHaveBeenCalledOnce()
    expect(JSON.stringify(error)).not.toContain(API_KEY)
  })

  it.each([204])('rejects undocumented successful HTTP %i responses', async (status) => {
    mockFetch.mockResolvedValue(new Response(status === 204 ? null : '{}', { status }))

    const error = await expectValidationError(
      validateHarmonicServiceAccount({ apiToken: API_KEY }),
      'provider_unavailable'
    )

    expect(error.status).toBe(status)
    expect(JSON.stringify(error)).not.toContain(API_KEY)
  })

  it('maps provider failures to provider_unavailable without retaining the response body', async () => {
    const response = new Response(`upstream echoed ${API_KEY}`, { status: 500 })
    const cancel = vi.spyOn(response.body!, 'cancel')
    mockFetch.mockResolvedValue(response)

    const error = await expectValidationError(
      validateHarmonicServiceAccount({ apiToken: API_KEY }),
      'provider_unavailable'
    )

    expect(error.status).toBe(500)
    expect(cancel).toHaveBeenCalledOnce()
    expect(JSON.stringify(error)).not.toContain(API_KEY)
    expect(error.logDetail).toEqual({
      step: 'saved_searches',
      reason: 'provider returned HTTP 500',
    })
  })
})
