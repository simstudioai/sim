import { jsonResponse } from '@sim/testing/helpers/http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { validateLinearServiceAccount } from '@/lib/credentials/token-service-accounts/validators/linear'
import { linearAuthorizationHeader } from '@/tools/linear/utils'

const mockFetch = vi.fn()

describe('validateLinearServiceAccount', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
  })

  it('sends the raw API key, without a Bearer prefix, to the GraphQL endpoint', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(
        {
          data: {
            viewer: { id: 'viewer-1', name: 'Jane Ops', email: 'jane@acme.com' },
            organization: { id: 'org-1', name: 'Acme' },
          },
        },
        200
      )
    )

    await validateLinearServiceAccount({ apiToken: 'lin_api_abc' })

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

  it('throws invalid_credentials on 200 with authentication errors', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(
        {
          errors: [{ message: 'Not authorized', extensions: { code: 'authentication_error' } }],
        },
        200
      )
    )

    await expect(
      validateLinearServiceAccount({ apiToken: 'lin_api_revoked' })
    ).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'invalid_credentials',
      status: 200,
    })
  })

  it('throws provider_unavailable on 400 with a rate-limit body', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(
        {
          errors: [{ message: 'Rate limit exceeded', extensions: { code: 'RATELIMITED' } }],
        },
        400
      )
    )

    await expect(validateLinearServiceAccount({ apiToken: 'lin_api_abc' })).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'provider_unavailable',
      status: 400,
    })
  })

  it('throws invalid_credentials on 400 with an authentication body', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(
        {
          errors: [
            { message: 'Authentication required', extensions: { code: 'authentication_error' } },
          ],
        },
        400
      )
    )

    await expect(validateLinearServiceAccount({ apiToken: 'lin_api_bad' })).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'invalid_credentials',
      status: 400,
    })
  })

  it('throws provider_unavailable on an ambiguous 400 body', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ errors: [{ message: 'Malformed request' }] }, 400)
    )

    await expect(validateLinearServiceAccount({ apiToken: 'lin_api_abc' })).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'provider_unavailable',
      status: 400,
    })
  })
})
