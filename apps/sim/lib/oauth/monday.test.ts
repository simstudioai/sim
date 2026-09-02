/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  exchangeMondayAuthorizationCode,
  MONDAY_OAUTH_TOKEN_URL,
  resolveMondayAccessTokenExpiresAt,
} from '@/lib/oauth/monday'

const SCOPES = [
  'boards:read',
  'boards:write',
  'updates:read',
  'updates:write',
  'webhooks:read',
  'webhooks:write',
  'me:read',
]

function unsignedJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${header}.${body}.signature`
}

function tokenResponse(overrides: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      access_token: unsignedJwt({ exp: Math.floor(Date.now() / 1000) + 3600 }),
      refresh_token: 'monday-refresh-token',
      token_type: 'Bearer',
      scope: SCOPES.join(' '),
      ...overrides,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
}

describe('Monday OAuth 2.1', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('exchanges a PKCE authorization code at the v2 endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(tokenResponse())
    vi.stubGlobal('fetch', fetchMock)

    const tokens = await exchangeMondayAuthorizationCode({
      clientId: 'monday-client-id',
      clientSecret: 'monday-client-secret',
      code: 'authorization-code',
      codeVerifier: 'pkce-verifier',
      redirectUri: 'https://www.sim.ai/api/auth/oauth2/callback/monday',
    })

    expect(tokens).toMatchObject({
      refreshToken: 'monday-refresh-token',
      tokenType: 'Bearer',
      scopes: SCOPES,
    })
    expect(tokens.accessTokenExpiresAt).toBeInstanceOf(Date)

    const [endpoint, request] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(endpoint).toBe(MONDAY_OAUTH_TOKEN_URL)
    expect(request).toMatchObject({
      method: 'POST',
      redirect: 'error',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    })
    expect(JSON.parse(request.body as string)).toEqual({
      grant_type: 'authorization_code',
      client_id: 'monday-client-id',
      client_secret: 'monday-client-secret',
      code: 'authorization-code',
      redirect_uri: 'https://www.sim.ai/api/auth/oauth2/callback/monday',
      code_verifier: 'pkce-verifier',
    })
  })

  it('uses the access-token JWT expiration before response and fallback lifetimes', () => {
    const now = new Date('2026-09-01T12:00:00.000Z')
    const jwtExpirySeconds = Math.floor(now.getTime() / 1000) + 2700
    const expiresAt = resolveMondayAccessTokenExpiresAt(
      unsignedJwt({ exp: jwtExpirySeconds }),
      1800,
      now
    )

    expect(expiresAt).toEqual(new Date(jwtExpirySeconds * 1000))
  })

  it('preserves an expired JWT expiration so the credential refreshes immediately', () => {
    const now = new Date('2026-09-01T12:00:00.000Z')
    const jwtExpirySeconds = Math.floor(now.getTime() / 1000) - 60

    expect(
      resolveMondayAccessTokenExpiresAt(unsignedJwt({ exp: jwtExpirySeconds }), 3600, now)
    ).toEqual(new Date(jwtExpirySeconds * 1000))
  })

  it('falls back to expires_in and then one hour for an opaque access token', () => {
    const now = new Date('2026-09-01T12:00:00.000Z')

    expect(resolveMondayAccessTokenExpiresAt('opaque-token', 1200, now)).toEqual(
      new Date('2026-09-01T12:20:00.000Z')
    )
    expect(resolveMondayAccessTokenExpiresAt('opaque-token', undefined, now)).toEqual(
      new Date('2026-09-01T13:00:00.000Z')
    )
  })

  it.each([
    ['missing refresh token', { refresh_token: undefined }],
    ['missing access token', { access_token: undefined }],
    ['non-bearer token', { token_type: 'mac' }],
  ])('rejects an incomplete response: %s', async (_label, overrides) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(tokenResponse(overrides)))

    await expect(
      exchangeMondayAuthorizationCode({
        clientId: 'client-id',
        clientSecret: 'client-secret',
        code: 'authorization-code',
        codeVerifier: 'pkce-verifier',
        redirectUri: 'https://www.sim.ai/api/auth/oauth2/callback/monday',
      })
    ).rejects.toThrow('Monday OAuth token response was incomplete')
  })

  it('does not expose a provider error response or request secrets', async () => {
    const providerSecret = 'provider-secret-that-must-not-escape'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: providerSecret }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    )

    const error = await exchangeMondayAuthorizationCode({
      clientId: 'client-id',
      clientSecret: 'client-secret-that-must-not-escape',
      code: 'authorization-code-that-must-not-escape',
      codeVerifier: 'pkce-verifier-that-must-not-escape',
      redirectUri: 'https://www.sim.ai/api/auth/oauth2/callback/monday',
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('Monday OAuth token exchange failed with HTTP 400')
    expect((error as Error).message).not.toContain(providerSecret)
  })
})
