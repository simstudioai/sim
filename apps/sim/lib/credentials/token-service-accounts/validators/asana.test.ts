/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TokenServiceAccountValidationError } from '@/lib/credentials/token-service-accounts/errors'
import { validateAsanaServiceAccount } from '@/lib/credentials/token-service-accounts/validators/asana'

const mockFetch = vi.fn()

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('validateAsanaServiceAccount', () => {
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
        data: { gid: '12345', name: 'Sim Integration', email: 'bot@example.com' },
      })
    )

    const result = await validateAsanaServiceAccount({ apiToken: 'token-1' })

    expect(result).toEqual({
      displayName: 'Sim Integration',
      auditMetadata: { asanaUserGid: '12345' },
      storedMetadata: { userGid: '12345', email: 'bot@example.com' },
    })
    expect(mockFetch).toHaveBeenCalledWith(
      'https://app.asana.com/api/1.0/users/me?opt_fields=gid,name,email',
      {
        headers: {
          Authorization: 'Bearer token-1',
          Accept: 'application/json',
        },
      }
    )
  })

  it('falls back to email then gid when name is missing', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, { data: { gid: '999', email: 'fallback@example.com' } })
    )

    const withEmail = await validateAsanaServiceAccount({ apiToken: 'token-2' })
    expect(withEmail.displayName).toBe('fallback@example.com')

    mockFetch.mockResolvedValue(jsonResponse(200, { data: { gid: '999' } }))

    const gidOnly = await validateAsanaServiceAccount({ apiToken: 'token-2' })
    expect(gidOnly.displayName).toBe('Asana user 999')
    expect(gidOnly.storedMetadata).toEqual({ userGid: '999' })
  })

  it('maps 401 to invalid_credentials', async () => {
    mockFetch.mockResolvedValue(jsonResponse(401, { errors: [{ message: 'Not Authorized' }] }))

    const error = await validateAsanaServiceAccount({ apiToken: 'bad-token' }).catch((e) => e)

    expect(error).toBeInstanceOf(TokenServiceAccountValidationError)
    expect(error.code).toBe('invalid_credentials')
    expect(error.status).toBe(401)
  })

  it('maps 500 to provider_unavailable', async () => {
    mockFetch.mockResolvedValue(jsonResponse(500, { errors: [{ message: 'Server error' }] }))

    const error = await validateAsanaServiceAccount({ apiToken: 'token-3' }).catch((e) => e)

    expect(error).toBeInstanceOf(TokenServiceAccountValidationError)
    expect(error.code).toBe('provider_unavailable')
    expect(error.status).toBe(500)
  })

  it('maps a 200 response missing data.gid to provider_unavailable', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { data: { name: 'No Gid' } }))

    const error = await validateAsanaServiceAccount({ apiToken: 'token-4' }).catch((e) => e)

    expect(error).toBeInstanceOf(TokenServiceAccountValidationError)
    expect(error.code).toBe('provider_unavailable')
    expect(error.status).toBe(502)
  })
})
