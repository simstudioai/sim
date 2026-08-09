/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TokenServiceAccountValidationError } from '@/lib/credentials/token-service-accounts/errors'
import { validateSnowflakeServiceAccount } from '@/lib/credentials/token-service-accounts/validators/snowflake'

const mockFetch = vi.fn()

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const fields = { apiToken: 'pat-secret', domain: 'MyOrg-MyAccount.snowflakecomputing.com' }

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(TokenServiceAccountValidationError)
  await promise.catch((error: TokenServiceAccountValidationError) => {
    expect(error.code).toBe(code)
  })
}

describe('validateSnowflakeServiceAccount', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('verifies through the SQL API with the PAT headers the tools use', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, { data: [['SVC_USER', 'MYORG-MYACCOUNT', 'ANALYST']] })
    )

    const result = await validateSnowflakeServiceAccount(fields)

    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('https://myorg-myaccount.snowflakecomputing.com/api/v2/statements')
    expect(init.headers.Authorization).toBe('Bearer pat-secret')
    expect(init.headers['X-Snowflake-Authorization-Token-Type']).toBe('PROGRAMMATIC_ACCESS_TOKEN')

    expect(result).toEqual({
      displayName: 'SVC_USER (MYORG-MYACCOUNT)',
      principal: { kind: 'user', id: 'SVC_USER' },
      auditMetadata: { account: 'MYORG-MYACCOUNT', role: 'ANALYST' },
      storedMetadata: { account: 'MYORG-MYACCOUNT', role: 'ANALYST' },
      normalizedDomain: 'myorg-myaccount.snowflakecomputing.com',
    })
  })

  it('rejects a host that is not a Snowflake account hostname before any request', async () => {
    await expectCode(
      validateSnowflakeServiceAccount({ ...fields, domain: 'evil.com' }),
      'site_not_found'
    )
    expect(mockFetch).not.toHaveBeenCalled()
  })

  /**
   * Snowflake wildcard-resolves `*.snowflakecomputing.com`, so a mistyped
   * account answers 404 instead of failing DNS. Without this mapping the user
   * is told the provider is down for a host that will never work.
   */
  it('maps a 404 to a bad account host, not a provider outage', async () => {
    mockFetch.mockResolvedValueOnce(new Response('File not Found', { status: 404 }))
    await expectCode(validateSnowflakeServiceAccount(fields), 'site_not_found')
  })

  it('maps 401 to a rejected token and 403 to the SQL API being disabled', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(401, { message: 'invalid token' }))
    await expectCode(validateSnowflakeServiceAccount(fields), 'invalid_credentials')

    mockFetch.mockResolvedValueOnce(jsonResponse(403, { message: 'SQL API not enabled' }))
    await expectCode(validateSnowflakeServiceAccount(fields), 'provider_unavailable')
  })

  it('treats a deferred statement and a metadata-less success as provider problems', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(202, { statementHandle: 'abc' }))
    await expectCode(validateSnowflakeServiceAccount(fields), 'provider_unavailable')

    mockFetch.mockResolvedValueOnce(jsonResponse(200, { data: [] }))
    await expectCode(validateSnowflakeServiceAccount(fields), 'provider_unavailable')
  })

  it('falls back to the account when the token reports no user', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { data: [[null, 'MYORG-MYACCOUNT', null]] }))
    const result = await validateSnowflakeServiceAccount(fields)
    expect(result.displayName).toBe('MYORG-MYACCOUNT')
    expect(result.principal).toEqual({ kind: 'tenant', id: 'MYORG-MYACCOUNT' })
    expect(result.auditMetadata).toEqual({ account: 'MYORG-MYACCOUNT' })
  })
})
