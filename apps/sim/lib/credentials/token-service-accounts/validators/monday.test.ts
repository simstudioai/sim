import { jsonResponse } from '@sim/testing/helpers/http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TokenServiceAccountValidationError } from '@/lib/credentials/token-service-accounts/errors'
import { validateMondayServiceAccount } from '@/lib/credentials/token-service-accounts/validators/monday'

const mockFetch = vi.fn()

describe('validateMondayServiceAccount', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
  })

  it('sends the raw token with the pinned API version', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        data: {
          me: { id: '12345', name: 'Jane Ops', email: 'jane@example.com' },
          account: { id: 987, name: 'Acme', slug: 'acme' },
        },
      })
    )

    await validateMondayServiceAccount({ apiToken: 'eyJtoken' })

    expect(mockFetch).toHaveBeenCalledWith('https://api.monday.com/v2', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'eyJtoken',
        'API-Version': '2026-04',
      },
      body: JSON.stringify({
        query: 'query { me { id name email } account { id name slug } }',
      }),
      signal: expect.any(AbortSignal),
    })
  })

  it.each([{ errors: [{ message: 'Not Authenticated' }] }, { error_message: 'Not Authenticated' }])(
    'throws invalid_credentials on a 200 auth error body %#',
    async (body) => {
      mockFetch.mockResolvedValueOnce(jsonResponse(body))

      const error = await validateMondayServiceAccount({ apiToken: 'stale' }).catch((e) => e)

      expect(error).toBeInstanceOf(TokenServiceAccountValidationError)
      expect(error.code).toBe('invalid_credentials')
      expect(error.status).toBe(200)
    }
  )

  it('throws provider_unavailable on 200 with INTERNAL_SERVER_ERROR extensions', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        errors: [
          {
            message: 'Internal server error',
            extensions: { code: 'INTERNAL_SERVER_ERROR', status_code: 500 },
          },
        ],
      })
    )

    const error = await validateMondayServiceAccount({ apiToken: 'tok' }).catch((e) => e)

    expect(error).toBeInstanceOf(TokenServiceAccountValidationError)
    expect(error.code).toBe('provider_unavailable')
    expect(error.status).toBe(502)
  })

  it('throws provider_unavailable when the provider-side error is not first in the array', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        errors: [
          { message: 'Field deprecation warning' },
          {
            message: 'Rate limit exceeded',
            extensions: { code: 'RATE_LIMIT_EXCEEDED', status_code: 429 },
          },
        ],
      })
    )

    const error = await validateMondayServiceAccount({ apiToken: 'tok' }).catch((e) => e)

    expect(error).toBeInstanceOf(TokenServiceAccountValidationError)
    expect(error.code).toBe('provider_unavailable')
    expect(error.status).toBe(502)
  })

  it('accepts a valid token when warnings accompany successful me data', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        data: { me: { id: 77, name: 'Bot User' }, account: { id: 5, name: 'Acme', slug: 'acme' } },
        errors: [{ message: 'Deprecated field usage', extensions: { code: 'DEPRECATED' } }],
      })
    )
    const result = await validateMondayServiceAccount({ apiToken: 'token' })
    expect(result.displayName).toBe('Acme')
    expect(result.principal).toEqual({ kind: 'user', id: '77', label: 'Bot User' })
  })
})
