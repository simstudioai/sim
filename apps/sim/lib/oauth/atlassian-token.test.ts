import { afterEach, describe, expect, it, vi } from 'vitest'
import { exchangeAtlassianAuthorizationCode } from '@/lib/oauth/atlassian-token'

describe('Atlassian 3LO token exchange', () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each(['jira'] as const)(
    'sends the %s client credentials and PKCE verifier in JSON',
    async (provider) => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            access_token: 'atlassian-access',
            refresh_token: 'atlassian-refresh',
            expires_in: 3600,
            scope: 'read:me offline_access',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
      vi.stubGlobal('fetch', fetchMock)

      const tokens = await exchangeAtlassianAuthorizationCode({
        provider,
        clientId: 'test-client',
        clientSecret: 'test-secret',
        code: 'one-time-code',
        redirectUri: `http://localhost:3000/api/auth/oauth2/callback/${provider}`,
        codeVerifier: 'pkce-verifier',
      })

      expect(tokens).toMatchObject({
        accessToken: 'atlassian-access',
        refreshToken: 'atlassian-refresh',
        tokenType: 'Bearer',
        scopes: ['read:me', 'offline_access'],
      })
      const [endpoint, request] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(endpoint).toBe('https://auth.atlassian.com/oauth/token')
      expect(request).toMatchObject({
        method: 'POST',
        redirect: 'error',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      })
      expect(JSON.parse(request.body as string)).toEqual({
        grant_type: 'authorization_code',
        client_id: 'test-client',
        client_secret: 'test-secret',
        code: 'one-time-code',
        redirect_uri: `http://localhost:3000/api/auth/oauth2/callback/${provider}`,
        code_verifier: 'pkce-verifier',
      })
    }
  )
})
