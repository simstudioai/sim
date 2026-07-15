/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TokenServiceAccountValidationError } from '@/lib/credentials/token-service-accounts/errors'
import { validateAirtableServiceAccount } from '@/lib/credentials/token-service-accounts/validators/airtable'

const mockFetch = vi.fn()

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('validateAirtableServiceAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns email display name and metadata on success with email', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, {
        id: 'usrABC123',
        email: 'svc@example.com',
        scopes: ['data.records:read'],
      })
    )

    const result = await validateAirtableServiceAccount({ apiToken: 'pat123.secret' })

    expect(result).toEqual({
      displayName: 'svc@example.com',
      auditMetadata: { airtableUserId: 'usrABC123' },
      storedMetadata: { userId: 'usrABC123', scopes: 'data.records:read' },
    })
    expect(mockFetch).toHaveBeenCalledWith('https://api.airtable.com/v0/meta/whoami', {
      headers: {
        Authorization: 'Bearer pat123.secret',
        Accept: 'application/json',
      },
    })
  })

  it('falls back to id display name when email is absent', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { id: 'usrXYZ789' }))

    const result = await validateAirtableServiceAccount({ apiToken: 'pat456.secret' })

    expect(result.displayName).toBe('Airtable user usrXYZ789')
    expect(result.auditMetadata).toEqual({ airtableUserId: 'usrXYZ789' })
    expect(result.storedMetadata).toEqual({ userId: 'usrXYZ789' })
  })

  it('throws invalid_credentials on 401', async () => {
    mockFetch.mockResolvedValueOnce(new Response('', { status: 401 }))

    const error = await validateAirtableServiceAccount({ apiToken: 'bad' }).catch((e) => e)

    expect(error).toBeInstanceOf(TokenServiceAccountValidationError)
    expect(error.code).toBe('invalid_credentials')
    expect(error.status).toBe(401)
  })

  it('throws provider_unavailable when a 200 body is missing id', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { email: 'svc@example.com' }))

    const error = await validateAirtableServiceAccount({ apiToken: 'pat' }).catch((e) => e)

    expect(error).toBeInstanceOf(TokenServiceAccountValidationError)
    expect(error.code).toBe('provider_unavailable')
    expect(error.status).toBe(502)
  })

  it('throws provider_unavailable on 500', async () => {
    mockFetch.mockResolvedValueOnce(new Response('server error', { status: 500 }))

    const error = await validateAirtableServiceAccount({ apiToken: 'pat' }).catch((e) => e)

    expect(error).toBeInstanceOf(TokenServiceAccountValidationError)
    expect(error.code).toBe('provider_unavailable')
    expect(error.status).toBe(500)
  })
})
