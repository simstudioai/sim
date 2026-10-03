import { jsonResponse } from '@sim/testing/helpers/http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TokenServiceAccountValidationError } from '@/lib/credentials/token-service-accounts/errors'
import { validateSnowflakeServiceAccount } from '@/lib/credentials/token-service-accounts/validators/snowflake'

const mockFetch = vi.fn()

const fields = { apiToken: 'pat-secret', domain: 'MyOrg-MyAccount.snowflakecomputing.com' }

async function expectCode(promise: Promise<unknown>, code: string, status?: number) {
  await expect(promise).rejects.toBeInstanceOf(TokenServiceAccountValidationError)
  await promise.catch((error: TokenServiceAccountValidationError) => {
    expect(error.code).toBe(code)
    if (status !== undefined) expect(error.status).toBe(status)
  })
}

describe('validateSnowflakeServiceAccount', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    // resetAllMocks, not clearAllMocks: the latter leaves queued
    // mockResolvedValueOnce values behind to leak into the next test.
    vi.resetAllMocks()
  })

  it('verifies through the SQL API with the PAT headers the tools use', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ data: [['SVC_USER', 'MYORG-MYACCOUNT', 'ANALYST']] })
    )

    await validateSnowflakeServiceAccount(fields)

    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('https://myorg-myaccount.snowflakecomputing.com/api/v2/statements')
    expect(init.headers.Authorization).toBe('Bearer pat-secret')
    expect(init.headers['X-Snowflake-Authorization-Token-Type']).toBe('PROGRAMMATIC_ACCESS_TOKEN')
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

  it('treats a deferred statement and a metadata-less success as distinct provider problems', async () => {
    // The status is what separates these two: without the 202 branch the
    // deferred response would fall through to the metadata-less path and throw
    // 502, so asserting only the code cannot tell them apart.
    mockFetch.mockResolvedValueOnce(jsonResponse({ statementHandle: 'abc' }, 202))
    await expectCode(validateSnowflakeServiceAccount(fields), 'provider_unavailable', 202)

    mockFetch.mockResolvedValueOnce(jsonResponse({ data: [] }))
    await expectCode(validateSnowflakeServiceAccount(fields), 'provider_unavailable', 502)
  })

  it('falls back to the account when the token reports no user', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: [[null, 'MYORG-MYACCOUNT', null]] }))
    const result = await validateSnowflakeServiceAccount(fields)
    expect(result.displayName).toBe('MYORG-MYACCOUNT')
    expect(result.principal).toEqual({ kind: 'tenant', id: 'MYORG-MYACCOUNT' })
    expect(result.auditMetadata).toEqual({ account: 'MYORG-MYACCOUNT' })
  })
})
