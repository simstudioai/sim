/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TokenServiceAccountValidationError } from '@/lib/credentials/token-service-accounts/errors'
import { validateAttioServiceAccount } from '@/lib/credentials/token-service-accounts/validators/attio'

const mockFetch = vi.fn()

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

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
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns workspace info on an active token', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        active: true,
        workspace_id: 'ws-123',
        workspace_name: 'Acme CRM',
        workspace_slug: 'acme-crm',
      })
    )

    const result = await validateAttioServiceAccount({ apiToken: 'attio-token' })

    expect(mockFetch).toHaveBeenCalledWith('https://api.attio.com/v2/self', {
      headers: {
        Authorization: 'Bearer attio-token',
        Accept: 'application/json',
      },
    })
    expect(result).toEqual({
      displayName: 'Acme CRM',
      auditMetadata: { attioWorkspaceId: 'ws-123' },
      storedMetadata: { workspaceId: 'ws-123', workspaceSlug: 'acme-crm' },
    })
  })

  it('maps a 401 to invalid_credentials', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: 'unauthorized' }, 401))

    await expectValidationError(
      validateAttioServiceAccount({ apiToken: 'bad-token' }),
      'invalid_credentials'
    )
  })

  it('maps a 500 to provider_unavailable', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: 'boom' }, 500))

    await expectValidationError(
      validateAttioServiceAccount({ apiToken: 'attio-token' }),
      'provider_unavailable'
    )
  })

  it('maps a malformed 200 (missing workspace fields) to provider_unavailable', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ unexpected: 'shape' }))

    await expectValidationError(
      validateAttioServiceAccount({ apiToken: 'attio-token' }),
      'provider_unavailable'
    )
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
