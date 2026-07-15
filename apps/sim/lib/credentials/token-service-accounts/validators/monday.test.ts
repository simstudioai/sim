/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TokenServiceAccountValidationError } from '@/lib/credentials/token-service-accounts/errors'
import { validateMondayServiceAccount } from '@/lib/credentials/token-service-accounts/validators/monday'

const mockFetch = vi.fn()

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('validateMondayServiceAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns account display name and metadata on success', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, {
        data: {
          me: { id: '12345', name: 'Jane Ops', email: 'jane@example.com' },
          account: { id: 987, name: 'Acme', slug: 'acme' },
        },
      })
    )

    const result = await validateMondayServiceAccount({ apiToken: 'eyJtoken' })

    expect(result).toEqual({
      displayName: 'Acme',
      auditMetadata: { mondayAccountId: '987' },
      storedMetadata: { accountId: '987', accountSlug: 'acme', userId: '12345' },
    })
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
    })
  })

  it('throws invalid_credentials on 401', async () => {
    mockFetch.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))

    const error = await validateMondayServiceAccount({ apiToken: 'bad' }).catch((e) => e)

    expect(error).toBeInstanceOf(TokenServiceAccountValidationError)
    expect(error.code).toBe('invalid_credentials')
    expect(error.status).toBe(401)
  })

  it('throws invalid_credentials on 200 with errors array', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, { errors: [{ message: 'Not Authenticated' }] })
    )

    const error = await validateMondayServiceAccount({ apiToken: 'stale' }).catch((e) => e)

    expect(error).toBeInstanceOf(TokenServiceAccountValidationError)
    expect(error.code).toBe('invalid_credentials')
    expect(error.status).toBe(200)
  })

  it('throws invalid_credentials on 200 with top-level error_message', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { error_message: 'Not Authenticated' }))

    const error = await validateMondayServiceAccount({ apiToken: 'stale' }).catch((e) => e)

    expect(error).toBeInstanceOf(TokenServiceAccountValidationError)
    expect(error.code).toBe('invalid_credentials')
    expect(error.status).toBe(200)
  })

  it('throws provider_unavailable on 200 with INTERNAL_SERVER_ERROR extensions', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, {
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
      jsonResponse(200, {
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

  it('omits mondayAccountId from auditMetadata when account is absent', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, {
        data: { me: { id: '12345', name: 'Jane Ops', email: 'jane@example.com' } },
      })
    )

    const result = await validateMondayServiceAccount({ apiToken: 'eyJtoken' })

    expect(result.auditMetadata).toEqual({})
    expect(result.auditMetadata).not.toHaveProperty('mondayAccountId')
    expect(result.displayName).toBe('Jane Ops')
  })

  it('throws provider_unavailable on 500', async () => {
    mockFetch.mockResolvedValueOnce(new Response('server error', { status: 500 }))

    const error = await validateMondayServiceAccount({ apiToken: 'tok' }).catch((e) => e)

    expect(error).toBeInstanceOf(TokenServiceAccountValidationError)
    expect(error.code).toBe('provider_unavailable')
    expect(error.status).toBe(500)
  })
})
