import { jsonResponse } from '@sim/testing/helpers/http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TokenServiceAccountValidationError } from '@/lib/credentials/token-service-accounts/errors'
import { validateAttioServiceAccount } from '@/lib/credentials/token-service-accounts/validators/attio'

const mockFetch = vi.fn()

async function expectValidationError(
  promise: Promise<unknown>,
  code: string
): Promise<TokenServiceAccountValidationError> {
  const error = await promise.then(
    () => {
      throw new Error('expected validation to throw')
    },
    (e: unknown) => e
  )
  expect(error).toBeInstanceOf(TokenServiceAccountValidationError)
  expect((error as TokenServiceAccountValidationError).code).toBe(code)
  return error as TokenServiceAccountValidationError
}

describe('validateAttioServiceAccount', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
  })

  it('sends the bearer token to the self endpoint', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        active: true,
        workspace_id: 'ws-123',
        workspace_name: 'Acme CRM',
        workspace_slug: 'acme-crm',
      })
    )

    await validateAttioServiceAccount({ apiToken: 'attio-token' })

    expect(mockFetch).toHaveBeenCalledWith('https://api.attio.com/v2/self', {
      headers: {
        Authorization: 'Bearer attio-token',
        Accept: 'application/json',
      },
      signal: expect.any(AbortSignal),
    })
  })

  it('maps a JSON-valid but non-object 200 body (null) to provider_unavailable', async () => {
    mockFetch.mockResolvedValue(jsonResponse(null))

    const error = await expectValidationError(
      validateAttioServiceAccount({ apiToken: 'attio-token' }),
      'provider_unavailable'
    )
    expect(error.logDetail).toEqual({ step: 'self', reason: 'non-object response body' })
  })

  it('maps a revoked token (active === false) to invalid_credentials', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ active: false }))

    await expectValidationError(
      validateAttioServiceAccount({ apiToken: 'revoked-token' }),
      'invalid_credentials'
    )
  })
})
