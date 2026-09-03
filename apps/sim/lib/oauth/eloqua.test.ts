/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ELOQUA_IDENTITY_URL,
  ELOQUA_OAUTH_TOKEN_URL,
  exchangeEloquaAuthorizationCode,
  extractEloquaInstanceUrl,
  fetchEloquaIdentity,
  normalizeEloquaInstanceUrl,
  withEloquaInstanceScope,
} from '@/lib/oauth/eloqua'

describe('Eloqua OAuth and instance discovery', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('exchanges a code with a Basic-authenticated JSON request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        token_type: 'bearer',
        expires_in: 3600,
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const tokens = await exchangeEloquaAuthorizationCode({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      code: 'authorization-code',
      redirectUri: 'https://www.sim.ai/api/auth/oauth2/callback/eloqua',
    })

    expect(tokens).toMatchObject({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      tokenType: 'bearer',
      scopes: ['full'],
    })
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(ELOQUA_OAUTH_TOKEN_URL)
    expect(request.headers).toEqual({
      Accept: 'application/json',
      Authorization: `Basic ${Buffer.from('client-id:client-secret').toString('base64')}`,
      'Content-Type': 'application/json',
    })
    expect(JSON.parse(request.body as string)).toEqual({
      grant_type: 'authorization_code',
      code: 'authorization-code',
      redirect_uri: 'https://www.sim.ai/api/auth/oauth2/callback/eloqua',
    })
  })

  it('discovers and projects the authenticated site, user, and pod', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        site: { id: 42, name: 'Example Site' },
        user: {
          id: 314,
          username: 'jane.smith',
          displayName: 'Jane Smith',
          firstName: 'Jane',
          lastName: 'Smith',
          emailAddress: 'jane@example.com',
        },
        urls: { base: 'https://secure.p03.eloqua.com/' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchEloquaIdentity('access-token')).resolves.toEqual({
      site: { id: '42', name: 'Example Site' },
      user: {
        id: '314',
        username: 'jane.smith',
        displayName: 'Jane Smith',
        firstName: 'Jane',
        lastName: 'Smith',
        emailAddress: 'jane@example.com',
      },
      instanceUrl: 'https://secure.p03.eloqua.com',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      ELOQUA_IDENTITY_URL,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer access-token' }),
        redirect: 'error',
      })
    )
  })

  it.each(['p01', 'p02', 'p03', 'p04', 'p06', 'p07', 'p08'])(
    'accepts the documented %s pod',
    (pod) => {
      expect(normalizeEloquaInstanceUrl(`https://secure.${pod}.eloqua.com/`)).toBe(
        `https://secure.${pod}.eloqua.com`
      )
    }
  )

  it.each([
    'http://secure.p03.eloqua.com',
    'https://secure.p05.eloqua.com',
    'https://secure.p03.eloqua.com.evil.example',
    'https://user@secure.p03.eloqua.com',
    'https://secure.p03.eloqua.com/api/rest',
    'https://secure.p03.eloqua.com?redirect=https://evil.example',
  ])('rejects an unsafe or malformed instance URL: %s', (value) => {
    expect(() => normalizeEloquaInstanceUrl(value)).toThrow()
  })

  it('round-trips the instance scope marker and ignores malformed markers', () => {
    const scopes = withEloquaInstanceScope('https://secure.p04.eloqua.com', ['full'])
    expect(scopes).toEqual(['__eloqua_instance__:https://secure.p04.eloqua.com', 'full'])
    expect(extractEloquaInstanceUrl(scopes.join(','))).toBe('https://secure.p04.eloqua.com')
    expect(extractEloquaInstanceUrl(scopes.join(' '))).toBe('https://secure.p04.eloqua.com')
    expect(
      extractEloquaInstanceUrl('__eloqua_instance__:https://evil.example full')
    ).toBeUndefined()
    expect(
      extractEloquaInstanceUrl(
        '__eloqua_instance__:https://secure.p03.eloqua.com,__eloqua_instance__:https://secure.p04.eloqua.com'
      )
    ).toBeUndefined()
  })
})
