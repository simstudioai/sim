/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TokenServiceAccountValidationError } from '@/lib/credentials/token-service-accounts/errors'
import { validateLinearServiceAccount } from '@/lib/credentials/token-service-accounts/validators/linear'
import { linearAuthorizationHeader } from '@/tools/linear/utils'

const mockFetch = vi.fn()

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('validateLinearServiceAccount', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('returns viewer and organization metadata on success', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, {
        data: {
          viewer: { id: 'viewer-1', name: 'Jane Ops', email: 'jane@acme.com' },
          organization: { id: 'org-1', name: 'Acme' },
        },
      })
    )

    const result = await validateLinearServiceAccount({ apiToken: 'lin_api_abc' })

    expect(result).toEqual({
      displayName: 'Acme',
      auditMetadata: { linearOrganizationId: 'org-1' },
      storedMetadata: { viewerId: 'viewer-1', organizationId: 'org-1' },
    })

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.linear.app/graphql')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe(linearAuthorizationHeader('lin_api_abc'))
    expect(headers.Authorization).toBe('lin_api_abc')
    expect(headers.Authorization).not.toContain('Bearer ')
    expect(JSON.parse(init.body as string)).toEqual({
      query: '{ viewer { id name email } organization { id name } }',
    })
  })

  it('throws invalid_credentials on 401', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(401, {
        errors: [{ message: 'Authentication required', extensions: { type: 'authentication_error' } }],
      })
    )

    await expect(validateLinearServiceAccount({ apiToken: 'lin_api_bad' })).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'invalid_credentials',
      status: 401,
    })
  })

  it('throws invalid_credentials on 200 with authentication errors', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, {
        errors: [{ message: 'Not authorized', extensions: { code: 'authentication_error' } }],
      })
    )

    await expect(validateLinearServiceAccount({ apiToken: 'lin_api_revoked' })).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'invalid_credentials',
      status: 200,
    })
  })

  it('throws provider_unavailable on 400 with a rate-limit body', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(400, {
        errors: [{ message: 'Rate limit exceeded', extensions: { code: 'RATELIMITED' } }],
      })
    )

    await expect(validateLinearServiceAccount({ apiToken: 'lin_api_abc' })).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'provider_unavailable',
      status: 400,
    })
  })

  it('throws invalid_credentials on 400 with an authentication body', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(400, {
        errors: [
          { message: 'Authentication required', extensions: { code: 'authentication_error' } },
        ],
      })
    )

    await expect(validateLinearServiceAccount({ apiToken: 'lin_api_bad' })).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'invalid_credentials',
      status: 400,
    })
  })

  it('throws provider_unavailable on an ambiguous 400 body', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(400, { errors: [{ message: 'Malformed request' }] })
    )

    await expect(validateLinearServiceAccount({ apiToken: 'lin_api_abc' })).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'provider_unavailable',
      status: 400,
    })
  })

  it('throws invalid_credentials on 200 with a forbidden error', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, {
        errors: [{ message: 'You do not have access', extensions: { type: 'Forbidden' } }],
      })
    )

    await expect(
      validateLinearServiceAccount({ apiToken: 'lin_api_scoped' })
    ).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'invalid_credentials',
      status: 200,
    })
  })

  it('throws provider_unavailable on a non-JSON 200 body', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('<html>proxy error</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      })
    )

    await expect(validateLinearServiceAccount({ apiToken: 'lin_api_abc' })).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'provider_unavailable',
      status: 502,
    })
  })

  it('throws provider_unavailable when fetch rejects with a network error', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'))

    await expect(validateLinearServiceAccount({ apiToken: 'lin_api_abc' })).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'provider_unavailable',
      status: 502,
    })
  })

  it('throws provider_unavailable on 500', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(500, { errors: [{ message: 'Internal error' }] }))

    const error = await validateLinearServiceAccount({ apiToken: 'lin_api_abc' }).catch((e) => e)

    expect(error).toBeInstanceOf(TokenServiceAccountValidationError)
    expect(error.code).toBe('provider_unavailable')
    expect(error.status).toBe(500)
  })
})
