/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CODA_SERVICE_ACCOUNT_PROVIDER_ID,
  TOKEN_SERVICE_ACCOUNT_DESCRIPTORS,
} from '@/lib/credentials/token-service-accounts/descriptors'
import { TokenServiceAccountValidationError } from '@/lib/credentials/token-service-accounts/errors'
import { getTokenServiceAccountValidator } from '@/lib/credentials/token-service-accounts/server'
import { validateCodaServiceAccount } from '@/lib/credentials/token-service-accounts/validators/coda'

const mockFetch = vi.fn()

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('validateCodaServiceAccount', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    mockFetch.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is registered with its descriptor', () => {
    expect(getTokenServiceAccountValidator(CODA_SERVICE_ACCOUNT_PROVIDER_ID)).toBe(
      validateCodaServiceAccount
    )
    expect(TOKEN_SERVICE_ACCOUNT_DESCRIPTORS[CODA_SERVICE_ACCOUNT_PROVIDER_ID]).toMatchObject({
      serviceLabel: 'Coda',
      fields: [{ id: 'apiToken', secret: true }],
    })
  })

  it('returns the token owner as principal and workspace metadata', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, {
        name: 'Jane Doe',
        loginId: 'jane@example.com',
        type: 'user',
        scoped: false,
        tokenName: 'Sim workflows',
        href: 'https://coda.io/apis/v1/whoami',
        workspace: { id: 'ws-1Ab234', type: 'workspace', name: 'Acme' },
      })
    )

    const result = await validateCodaServiceAccount({ apiToken: 'coda-token' })

    expect(result).toEqual({
      displayName: 'Sim workflows (jane@example.com)',
      principal: { kind: 'user', id: 'jane@example.com', label: 'Jane Doe' },
      auditMetadata: { codaWorkspaceId: 'ws-1Ab234' },
      storedMetadata: { workspaceId: 'ws-1Ab234', scoped: 'false', tokenName: 'Sim workflows' },
    })
    expect(mockFetch).toHaveBeenCalledWith('https://coda.io/apis/v1/whoami', {
      headers: { Authorization: 'Bearer coda-token', Accept: 'application/json' },
      redirect: 'error',
      signal: expect.any(AbortSignal),
    })
  })

  it('maps 401 to invalid_credentials', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(401, { statusCode: 401, statusMessage: 'Unauthorized', message: 'Unauthorized' })
    )

    const error = await validateCodaServiceAccount({ apiToken: 'bad' }).catch((e) => e)

    expect(error).toBeInstanceOf(TokenServiceAccountValidationError)
    expect(error.code).toBe('invalid_credentials')
    expect(error.status).toBe(401)
  })

  it('maps 429 and 500 to provider_unavailable', async () => {
    for (const status of [429, 500]) {
      mockFetch.mockResolvedValueOnce(jsonResponse(status, { message: 'nope' }))
      const error = await validateCodaServiceAccount({ apiToken: 'coda-token' }).catch((e) => e)
      expect(error.code).toBe('provider_unavailable')
    }
  })

  it('rejects a success body without a login id', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { name: 'Jane' }))

    const error = await validateCodaServiceAccount({ apiToken: 'coda-token' }).catch((e) => e)

    expect(error.code).toBe('provider_unavailable')
  })
})
