/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchQuickBooksUserInfo,
  getQuickBooksUserInfoEndpoints,
  mapQuickBooksUserInfo,
} from '@/lib/oauth/quickbooks'

describe('getQuickBooksUserInfoEndpoints', () => {
  it('prefers the sandbox endpoint for local development', () => {
    expect(getQuickBooksUserInfoEndpoints(true)).toEqual([
      'https://sandbox-accounts.platform.intuit.com/v1/openid_connect/userinfo',
      'https://accounts.platform.intuit.com/v1/openid_connect/userinfo',
    ])
  })

  it('prefers the production endpoint for production deployments', () => {
    expect(getQuickBooksUserInfoEndpoints(false)).toEqual([
      'https://accounts.platform.intuit.com/v1/openid_connect/userinfo',
      'https://sandbox-accounts.platform.intuit.com/v1/openid_connect/userinfo',
    ])
  })
})

describe('fetchQuickBooksUserInfo', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses the sandbox user-info endpoint and required headers locally', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          sub: 'intuit-user-1',
          email: 'user@example.com',
          emailVerified: true,
        })
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchQuickBooksUserInfo('access-token', true)).resolves.toMatchObject({
      sub: 'intuit-user-1',
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith(
      'https://sandbox-accounts.platform.intuit.com/v1/openid_connect/userinfo',
      {
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer access-token',
        },
      }
    )
  })

  it('normalizes and validates access tokens before making a user-info request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          sub: 'intuit-user-1',
        })
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchQuickBooksUserInfo('  access-token  ', true)).resolves.toMatchObject({
      sub: 'intuit-user-1',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://sandbox-accounts.platform.intuit.com/v1/openid_connect/userinfo',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer access-token' }),
      })
    )

    await expect(fetchQuickBooksUserInfo('token\r\nX-Injected: true', true)).rejects.toThrow(
      'QuickBooks access token contains invalid characters'
    )
    await expect(fetchQuickBooksUserInfo('x'.repeat(4097), true)).rejects.toThrow(
      'QuickBooks access token must be 4096 characters or less'
    )
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('falls back to production when the sandbox endpoint rejects the token', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            sub: 'intuit-user-2',
            email: 'user@example.com',
            emailVerified: true,
          })
        )
      )
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchQuickBooksUserInfo('access-token', true)).resolves.toMatchObject({
      sub: 'intuit-user-2',
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'https://accounts.platform.intuit.com/v1/openid_connect/userinfo'
    )
  })

  it('fails with endpoint statuses when neither environment accepts the token', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))
      .mockResolvedValueOnce(new Response('Forbidden', { status: 403 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchQuickBooksUserInfo('access-token', true)).rejects.toThrow(
      'sandbox-accounts.platform.intuit.com: HTTP 401; accounts.platform.intuit.com: HTTP 403'
    )
  })
})

describe('mapQuickBooksUserInfo', () => {
  it('maps Intuit camel-case profile fields to a stable OAuth identity', () => {
    expect(
      mapQuickBooksUserInfo({
        sub: 'intuit-user-3',
        givenName: 'Ada',
        familyName: 'Lovelace',
        email: 'ada@example.com',
        emailVerified: true,
      })
    ).toMatchObject({
      id: 'intuit-user-3',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      emailVerified: true,
    })
  })

  it('provides non-empty fallback fields when optional profile scopes omit them', () => {
    expect(mapQuickBooksUserInfo({ sub: 'intuit-user-4' })).toMatchObject({
      id: 'intuit-user-4',
      name: 'QuickBooks User',
      email: 'intuit-user-4@quickbooks.user',
      emailVerified: false,
    })
  })

  it('rejects a profile without Intuit subject identity', () => {
    expect(() => mapQuickBooksUserInfo({ email: 'user@example.com' })).toThrow(
      'did not include a subject'
    )
  })
})
