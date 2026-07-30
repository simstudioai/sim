import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createQuickBooksAccountId,
  fetchQuickBooksConnectionProfile,
  parseQuickBooksAccountId,
  QUICKBOOKS_AUTHORIZATION_URL,
  QUICKBOOKS_OIDC_CLAIMS,
  QUICKBOOKS_TOKEN_URL,
} from '@/lib/oauth/quickbooks'
import { QUICKBOOKS_MAX_USER_INFO_BYTES } from '@/lib/quickbooks/client'

const TEST_UUID = '01234567-89ab-4def-8abc-0123456789ab'
const originalFetch = global.fetch

afterEach(() => {
  global.fetch = originalFetch
})

describe('QuickBooks account identity', () => {
  it('pins the Intuit authorization, token, and realm claim contracts', () => {
    expect(QUICKBOOKS_AUTHORIZATION_URL).toBe('https://appcenter.intuit.com/connect/oauth2')
    expect(QUICKBOOKS_TOKEN_URL).toBe('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer')
    expect(QUICKBOOKS_OIDC_CLAIMS).toEqual({
      id_token: { realmId: null },
      userinfo: { realmId: null },
    })
  })

  it('creates and parses the company-scoped external account identity', () => {
    const accountId = createQuickBooksAccountId(' 123456789 ', 'intuit-subject', TEST_UUID)

    expect(accountId).toBe(`quickbooks:123456789:intuit-subject-${TEST_UUID}`)
    expect(parseQuickBooksAccountId(accountId)).toEqual({
      realmId: '123456789',
      subject: 'intuit-subject',
    })
  })

  it('keeps two companies connected by the same Intuit subject distinct', () => {
    const first = createQuickBooksAccountId('111', 'same-subject', TEST_UUID)
    const second = createQuickBooksAccountId('222', 'same-subject', TEST_UUID)

    expect(first).not.toBe(second)
    expect(parseQuickBooksAccountId(first).realmId).toBe('111')
    expect(parseQuickBooksAccountId(second).realmId).toBe('222')
  })

  it.each([
    'quickbooks:123:subject',
    'quickbooks:not-numeric:subject-01234567-89ab-4def-8abc-0123456789ab',
    'other:123:subject-01234567-89ab-4def-8abc-0123456789ab',
    'quickbooks:123:-01234567-89ab-4def-8abc-0123456789ab',
  ])('rejects malformed identities with reconnect guidance: %s', (accountId) => {
    expect(() => parseQuickBooksAccountId(accountId)).toThrow(/Reconnect the QuickBooks credential/)
  })
})

describe('QuickBooks connection profile', () => {
  it('uses bounded UserInfo claims and validates the same company before binding', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            sub: 'intuit-subject',
            realmId: '123456789',
            email: 'verified@example.test',
            emailVerified: true,
            givenName: 'Sanitized',
            familyName: 'User',
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            CompanyInfo: { Id: '123456789', CompanyName: 'Sanitized Company' },
          })
        )
      )
    global.fetch = fetchMock

    const result = await fetchQuickBooksConnectionProfile('fresh-access-token')

    expect(result).toMatchObject({
      realmId: '123456789',
      subject: 'intuit-subject',
      name: 'Sanitized User',
      email: 'verified@example.test',
      emailVerified: true,
    })
    expect(result.accountId).toMatch(/^quickbooks:123456789:intuit-subject-[0-9a-f-]{36}$/i)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://sandbox-accounts.platform.intuit.com/v1/openid_connect/userinfo'
    )
    expect(fetchMock.mock.calls[1][0].toString()).toContain(
      '/v3/company/123456789/companyinfo/123456789?minorversion=75'
    )
  })

  it('rejects missing realmId without falling back to the callback or ID token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          sub: 'intuit-subject',
          email: 'verified@example.test',
          emailVerified: true,
          givenName: 'Sanitized',
          familyName: 'User',
        })
      )
    )
    global.fetch = fetchMock

    await expect(fetchQuickBooksConnectionProfile('fresh-access-token')).rejects.toThrow(
      'required user and company identity'
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects a QuickBooks Fault returned with HTTP 200 during company validation', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            sub: 'intuit-subject',
            realmId: '123456789',
            email: 'verified@example.test',
            emailVerified: true,
            givenName: 'Sanitized',
            familyName: 'User',
          })
        )
      )
      .mockResolvedValueOnce(
        Response.json({
          Fault: {
            Error: [
              {
                code: '3200',
                Message: 'message=ApplicationAuthenticationFailed; errorCode=003200;',
                Detail: 'Token expired or invalid',
                ignored: 'must not be surfaced',
              },
            ],
          },
        })
      )
    global.fetch = fetchMock

    await expect(fetchQuickBooksConnectionProfile('fresh-access-token')).rejects.toThrow(
      /QuickBooks company validation failed.*3200.*Token expired or invalid.*Reconnect/
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('requires Intuit to verify the returned email address', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          sub: 'intuit-subject',
          realmId: '123456789',
          email: 'unverified@example.test',
          emailVerified: false,
          givenName: 'Sanitized',
          familyName: 'User',
        })
      )
    )
    global.fetch = fetchMock

    await expect(fetchQuickBooksConnectionProfile('fresh-access-token')).rejects.toThrow(
      'verified email address'
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects UserInfo larger than 1 MiB before parsing or company validation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          sub: 'intuit-subject',
          realmId: '123456789',
          padding: 'x'.repeat(QUICKBOOKS_MAX_USER_INFO_BYTES),
        })
      )
    )
    global.fetch = fetchMock

    await expect(fetchQuickBooksConnectionProfile('fresh-access-token')).rejects.toThrow(
      /exceeds maximum size/
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
