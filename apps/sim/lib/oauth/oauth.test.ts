import { createMockFetch, resetEnvMock, setEnv } from '@sim/testing'
import { getOAuth2Tokens } from 'better-auth/oauth2'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

beforeAll(() => {
  setEnv({
    NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    GOOGLE_CLIENT_ID: 'google_client_id',
    GOOGLE_CLIENT_SECRET: 'google_client_secret',
    TIKTOK_CLIENT_ID: 'tiktok_client_key',
    TIKTOK_CLIENT_SECRET: 'tiktok_client_secret',
    INSTAGRAM_CLIENT_ID: 'instagram_client_id',
    INSTAGRAM_CLIENT_SECRET: 'instagram_client_secret',
    AIRTABLE_CLIENT_ID: 'airtable_client_id',
    AIRTABLE_CLIENT_SECRET: 'airtable_client_secret',
    BITBUCKET_CLIENT_ID: 'bitbucket_client_id',
    BITBUCKET_CLIENT_SECRET: 'bitbucket_client_secret',
    NOTION_CLIENT_ID: 'notion_client_id',
    NOTION_CLIENT_SECRET: 'notion_client_secret',
    MICROSOFT_CLIENT_ID: 'microsoft_client_id',
    MICROSOFT_CLIENT_SECRET: 'microsoft_client_secret',
    SLACK_CLIENT_ID: 'slack_client_id',
    SLACK_CLIENT_SECRET: 'slack_client_secret',
    SALESFORCE_CLIENT_ID: 'salesforce_client_id',
    SALESFORCE_CLIENT_SECRET: 'salesforce_client_secret',
    ZOHO_CLIENT_ID: 'zoho_client_id',
    ZOHO_CLIENT_SECRET: undefined,
    CALCOM_CLIENT_ID: 'calcom_client_id',
    JIRA_CLIENT_ID: 'jira_client_id',
    JIRA_CLIENT_SECRET: 'jira_client_secret',
    MONDAY_CLIENT_ID: 'monday_client_id',
    MONDAY_CLIENT_SECRET: 'monday_client_secret',
  })
})

afterAll(resetEnvMock)

import { buildConnectorProviders } from '@/lib/auth/connectors/providers'
import { DEFAULT_MAX_ERROR_BODY_BYTES } from '@/lib/core/utils/stream-limits'
import { getPerRequestOAuthLinkScopes, OAUTH_PROVIDERS, refreshOAuthToken } from '@/lib/oauth'

/**
 * Default OAuth token response for successful requests.
 */
const defaultOAuthResponse = {
  ok: true,
  json: {
    access_token: 'new_access_token',
    expires_in: 3600,
    refresh_token: 'new_refresh_token',
  },
}

function oauthTestJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${header}.${body}.signature`
}

/**
 * Helper to run a function with a mocked global fetch.
 */
function withMockFetch<T>(mockFetch: ReturnType<typeof vi.fn>, fn: () => Promise<T>): Promise<T> {
  const originalFetch = global.fetch
  global.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const mocked = (await mockFetch(input, init)) as Partial<Response>
    if (mocked instanceof Response && mocked.body) return mocked

    let bodyText = ''
    if (typeof mocked.text === 'function') {
      bodyText = await mocked.text()
    } else if (typeof mocked.json === 'function') {
      bodyText = JSON.stringify(await mocked.json())
    }

    return new Response(bodyText, {
      status: mocked.status ?? 200,
      statusText: mocked.statusText,
      headers: mocked.headers,
    })
  })
  return fn().finally(() => {
    global.fetch = originalFetch
  })
}

function getMondayConnector() {
  const connector = buildConnectorProviders().find((candidate) => candidate.providerId === 'monday')
  if (!connector) throw new Error('Monday OAuth connector is not configured in this test')
  return connector
}

describe('Monday OAuth connector', () => {
  it('rejects GraphQL errors returned with HTTP 200 during user-info lookup', async () => {
    const getUserInfo = getMondayConnector().getUserInfo
    if (!getUserInfo) throw new Error('Monday OAuth connector must define getUserInfo')

    const userInfo = await withMockFetch(
      createMockFetch({
        json: {
          data: { me: { id: 'user-1', name: 'Person', email: 'person@example.com' } },
          errors: [{ message: 'Permission denied' }],
        },
      }),
      () => getUserInfo({ accessToken: 'access-token' })
    )

    expect(userInfo).toBeNull()
  })
})

describe('Microsoft Dataverse OAuth connector', () => {
  it('keeps static connector scopes empty and supplies the canonical legacy grant per request', () => {
    const connector = buildConnectorProviders().find(
      (candidate) => candidate.providerId === 'microsoft-dataverse'
    )
    if (!connector) throw new Error('Microsoft Dataverse OAuth connector is not configured')

    expect(connector.scopes).toEqual([])
    expect(getPerRequestOAuthLinkScopes('microsoft-dataverse')).toEqual(
      OAUTH_PROVIDERS.microsoft.services['microsoft-dataverse'].scopes
    )
    expect(getPerRequestOAuthLinkScopes('microsoft-excel')).toBeUndefined()
  })
})

function getBitbucketConnector() {
  const connector = buildConnectorProviders().find(
    (candidate) => candidate.providerId === 'bitbucket'
  )
  if (!connector) throw new Error('Bitbucket OAuth connector is not configured in this test')
  return connector
}

describe('Bitbucket OAuth Connector', () => {
  it('exchanges the authorization code with Basic auth and normalizes plural scopes', async () => {
    const connector = getBitbucketConnector()
    const getToken = connector.getToken
    if (!getToken) throw new Error('Bitbucket connector must define getToken')

    const scopes = [
      'account',
      'repository',
      'repository:write',
      'pullrequest',
      'pullrequest:write',
      'pipeline',
      'pipeline:write',
      'webhook',
    ]
    const mockFetch = createMockFetch({
      json: {
        access_token: 'bitbucket_access_token',
        expires_in: 3600,
        refresh_token: 'bitbucket_refresh_token',
        scopes: scopes.join(' '),
        token_type: 'bearer',
      },
    })

    const tokens = await withMockFetch(mockFetch, () =>
      getToken({
        code: 'authorization_code',
        redirectURI: 'http://localhost:3000/api/auth/oauth2/callback/bitbucket',
      })
    )

    expect(tokens.accessToken).toBe('bitbucket_access_token')
    expect(tokens.refreshToken).toBe('bitbucket_refresh_token')
    expect(tokens.scopes).toEqual(scopes)
    expect(tokens.accessTokenExpiresAt).toBeInstanceOf(Date)

    const [endpoint, requestOptions] = mockFetch.mock.calls[0] as [
      string,
      { headers: Record<string, string>; body: string },
    ]
    expect(endpoint).toBe('https://bitbucket.org/site/oauth2/access_token')
    expect(requestOptions.headers.Authorization).toBe(
      `Basic ${Buffer.from('bitbucket_client_id:bitbucket_client_secret').toString('base64')}`
    )
    expect(Object.fromEntries(new URLSearchParams(requestOptions.body))).toEqual({
      code: 'authorization_code',
      grant_type: 'authorization_code',
      redirect_uri: 'http://localhost:3000/api/auth/oauth2/callback/bitbucket',
    })
  })

  it('uses account_id before uuid and always synthesizes an internal email', async () => {
    const connector = getBitbucketConnector()
    const getUserInfo = connector.getUserInfo
    if (!getUserInfo) throw new Error('Bitbucket connector must define getUserInfo')
    const tokens = getOAuth2Tokens({ access_token: 'bitbucket_access_token' })

    const accountIdentity = await withMockFetch(
      createMockFetch({
        json: {
          account_id: 'account-123',
          uuid: '{uuid-ignored}',
          display_name: 'Ada Lovelace',
          links: { avatar: { href: 'https://example.invalid/avatar.png' } },
        },
      }),
      () => getUserInfo(tokens)
    )
    expect(accountIdentity?.id).toMatch(/^account-123-/)
    expect(accountIdentity?.email).toBe('bitbucket-account-123@connectors.sim.invalid')
    expect(accountIdentity?.name).toBe('Ada Lovelace')
    expect(accountIdentity?.image).toBe('https://example.invalid/avatar.png')

    const uuidIdentity = await withMockFetch(
      createMockFetch({ json: { uuid: '{uuid-456}', nickname: 'grace' } }),
      () => getUserInfo(tokens)
    )
    expect(uuidIdentity?.id).toMatch(/^\{uuid-456\}-/)
    expect(uuidIdentity?.email).toBe('bitbucket-uuid-456@connectors.sim.invalid')
    expect(uuidIdentity?.name).toBe('grace')
  })

  it('bounds Bitbucket user-info responses and supplies a provider deadline', async () => {
    const getUserInfo = getBitbucketConnector().getUserInfo
    if (!getUserInfo) throw new Error('Bitbucket connector must define getUserInfo')
    const mockFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      return new Response('{}', {
        headers: {
          'content-length': String(1024 * 1024 + 1),
          'content-type': 'application/json',
        },
      })
    })

    await expect(
      withMockFetch(mockFetch, () =>
        getUserInfo(getOAuth2Tokens({ access_token: 'bitbucket_access_token' }))
      )
    ).resolves.toBeNull()
    expect(mockFetch).toHaveBeenCalledOnce()
  })
})

describe('OAuth Token Refresh', () => {
  describe('Basic Auth Providers', () => {
    it.concurrent('sends Basic Auth credentials and keeps them out of the body', async () => {
      const mockFetch = createMockFetch(defaultOAuthResponse)
      const refreshToken = 'test_refresh_token'

      await withMockFetch(mockFetch, () => refreshOAuthToken('airtable', refreshToken))

      const [endpoint, requestOptions] = mockFetch.mock.calls[0] as [
        string,
        { headers: Record<string, string>; body: string },
      ]
      expect(endpoint).toBe('https://airtable.com/oauth2/v1/token')
      expect(requestOptions.headers.Authorization).toBe(
        `Basic ${Buffer.from('airtable_client_id:airtable_client_secret').toString('base64')}`
      )

      const bodyParams = new URLSearchParams(requestOptions.body)
      expect(Array.from(bodyParams.keys())).toEqual(['grant_type', 'refresh_token'])
      expect(bodyParams.get('refresh_token')).toBe(refreshToken)
    })

    it.each(['jira'] as const)(
      'refreshes %s with Atlassian JSON credentials',
      async (providerId) => {
        const mockFetch = createMockFetch(defaultOAuthResponse)
        await withMockFetch(mockFetch, () => refreshOAuthToken(providerId, 'test_refresh_token'))

        const [endpoint, request] = mockFetch.mock.calls[0] as [string, RequestInit]
        expect(endpoint).toBe('https://auth.atlassian.com/oauth/token')
        expect(request.headers).toMatchObject({ 'Content-Type': 'application/json' })
        expect(JSON.parse(request.body as string)).toEqual({
          grant_type: 'refresh_token',
          refresh_token: 'test_refresh_token',
          client_id: `${providerId}_client_id`,
          client_secret: `${providerId}_client_secret`,
        })
      }
    )

    it('preserves Intuit refresh-token lifetime metadata', async () => {
      const mockFetch = createMockFetch({
        ok: true,
        json: {
          access_token: 'new-access-token',
          expires_in: 3600,
          refresh_token: 'new-refresh-token',
          x_refresh_token_expires_in: 8_726_400,
        },
      })

      const result = await withMockFetch(mockFetch, () =>
        refreshOAuthToken('quickbooks', 'old-refresh-token', {
          clientId: 'quickbooks-client-id',
          clientSecret: 'quickbooks-client-secret',
          environment: 'sandbox',
        })
      )

      expect(result).toEqual({
        ok: true,
        accessToken: 'new-access-token',
        expiresIn: 3600,
        refreshToken: 'new-refresh-token',
        refreshTokenExpiresIn: 8_726_400,
      })
    })

    it('rejects a QuickBooks refresh response that omits its rotated refresh token', async () => {
      const mockFetch = createMockFetch({
        ok: true,
        json: {
          access_token: 'new-access-token',
          expires_in: 3600,
          x_refresh_token_expires_in: 8_726_400,
        },
      })

      await expect(
        withMockFetch(mockFetch, () =>
          refreshOAuthToken('quickbooks', 'old-refresh-token', {
            clientId: 'quickbooks-client-id',
            clientSecret: 'quickbooks-client-secret',
            environment: 'sandbox',
          })
        )
      ).resolves.toEqual({
        ok: false,
        message: 'Invalid QuickBooks token refresh response',
      })
    })
  })

  describe('Body Credential Providers', () => {
    /**
     * `salesforce-sandbox` borrows Salesforce's OAuth client but must post to the sandbox
     * authorization server that issued the refresh token.
     */
    it.each([
      {
        providerId: 'google',
        endpoint: 'https://oauth2.googleapis.com/token',
        clientPrefix: 'google',
      },
      {
        providerId: 'salesforce-sandbox',
        endpoint: 'https://test.salesforce.com/services/oauth2/token',
        clientPrefix: 'salesforce',
      },
    ])(
      'sends $providerId credentials in the body without Basic Auth',
      async ({ providerId, endpoint, clientPrefix }) => {
        const mockFetch = createMockFetch(defaultOAuthResponse)
        const refreshToken = 'test_refresh_token'

        await withMockFetch(mockFetch, () => refreshOAuthToken(providerId, refreshToken))

        const [calledEndpoint, requestOptions] = mockFetch.mock.calls[0] as [
          string,
          { headers: Record<string, string>; body: string },
        ]
        expect(calledEndpoint).toBe(endpoint)
        expect(requestOptions.headers.Authorization).toBeUndefined()

        const bodyParams = new URLSearchParams(requestOptions.body)
        expect(Object.fromEntries(bodyParams)).toEqual({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: `${clientPrefix}_client_id`,
          client_secret: `${clientPrefix}_client_secret`,
        })
      }
    )

    it.concurrent('should refresh TikTok with client_key instead of client_id', async () => {
      const mockFetch = createMockFetch(defaultOAuthResponse)
      const refreshToken = 'test_refresh_token'

      await withMockFetch(mockFetch, () => refreshOAuthToken('tiktok', refreshToken))

      const [endpoint, requestOptions] = mockFetch.mock.calls[0] as [string, { body: string }]
      const bodyParams = new URLSearchParams(requestOptions.body)

      expect(endpoint).toBe('https://open.tiktokapis.com/v2/oauth/token/')
      expect(bodyParams.get('client_key')).toBe('tiktok_client_key')
      expect(bodyParams.get('client_secret')).toBe('tiktok_client_secret')
      expect(bodyParams.get('refresh_token')).toBe(refreshToken)
      expect(bodyParams.get('client_id')).toBeNull()
    })

    it.concurrent('should preserve Cal.com bearer refresh authentication', async () => {
      const mockFetch = createMockFetch(defaultOAuthResponse)
      const refreshToken = 'test_refresh_token'

      await withMockFetch(mockFetch, () => refreshOAuthToken('calcom', refreshToken))

      const [endpoint, requestOptions] = mockFetch.mock.calls[0] as [
        string,
        { headers: Record<string, string>; body: string },
      ]
      const bodyParams = new URLSearchParams(requestOptions.body)

      expect(endpoint).toBe('https://app.cal.com/api/auth/oauth/refreshToken')
      expect(requestOptions.headers.Authorization).toBe(`Bearer ${refreshToken}`)
      expect(bodyParams.get('grant_type')).toBe('refresh_token')
      expect(bodyParams.get('client_id')).toBe('calcom_client_id')
      expect(bodyParams.get('client_secret')).toBeNull()
      expect(bodyParams.get('refresh_token')).toBeNull()
    })

    it.concurrent('should send Notion request with Basic Auth header and JSON body', async () => {
      const mockFetch = createMockFetch(defaultOAuthResponse)
      const refreshToken = 'test_refresh_token'

      await withMockFetch(mockFetch, () => refreshOAuthToken('notion', refreshToken))

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.notion.com/v1/oauth/token',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: expect.stringMatching(/^Basic /),
          }),
          body: expect.any(String),
        })
      )

      const [, requestOptions] = mockFetch.mock.calls[0] as [
        string,
        { headers: Record<string, string>; body: string },
      ]

      const authHeader = requestOptions.headers.Authorization
      const base64Credentials = authHeader.replace('Basic ', '')
      const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8')
      const [clientId, clientSecret] = credentials.split(':')

      expect(clientId).toBe('notion_client_id')
      expect(clientSecret).toBe('notion_client_secret')

      const bodyParams = JSON.parse(requestOptions.body)
      expect(bodyParams).toEqual({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      })
    })
  })

  describe('Error Handling', () => {
    it.concurrent('should return the canonical error for partial OAuth configuration', async () => {
      const mockFetch = createMockFetch(defaultOAuthResponse)

      const result = await withMockFetch(mockFetch, () =>
        refreshOAuthToken('zoho-desk', 'test_refresh_token')
      )

      expect(result).toEqual({
        ok: false,
        message:
          'OAuth client zoho-desk is partially configured — missing ZOHO_CLIENT_SECRET. Run npx sim-setup add integration zoho-desk.',
      })
      expect(mockFetch).not.toHaveBeenCalled()
    })
    it.concurrent('should return failure with errorCode for HTTP error responses', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () =>
          JSON.stringify({
            error: 'invalid_request',
            error_description: 'Invalid refresh token',
          }),
      })
      const refreshToken = 'test_refresh_token'

      const result = await withMockFetch(mockFetch, () => refreshOAuthToken('google', refreshToken))

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.errorCode).toBe('invalid_request')
      }
    })

    it.concurrent('should return failure for Slack-style body errors', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ ok: false, error: 'invalid_refresh_token' }),
      })
      const refreshToken = 'test_refresh_token'

      const result = await withMockFetch(mockFetch, () => refreshOAuthToken('slack', refreshToken))

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.errorCode).toBe('invalid_refresh_token')
      }
    })

    it.concurrent(
      'should redact literal and encoded credentials echoed by a provider',
      async () => {
        const refreshToken = 'refresh/with space'
        const formEncodedRefreshToken = new URLSearchParams({ value: refreshToken })
          .toString()
          .slice('value='.length)
        const mockFetch = vi
          .fn()
          .mockResolvedValue(
            new Response(
              `provider echo: ${refreshToken}, ${encodeURIComponent(refreshToken)}, ${formEncodedRefreshToken}, and google_client_secret`,
              { status: 400 }
            )
          )

        const result = await withMockFetch(mockFetch, () =>
          refreshOAuthToken('google', refreshToken)
        )

        expect(result.ok).toBe(false)
        if (!result.ok) {
          expect(result.message).not.toContain(refreshToken)
          expect(result.message).not.toContain(encodeURIComponent(refreshToken))
          expect(result.message).not.toContain(formEncodedRefreshToken)
          expect(result.message).not.toContain('google_client_secret')
        }
      }
    )

    it.concurrent('should redact a secret from a successful HTTP body error', async () => {
      const refreshToken = 'slack-refresh-secret'
      const mockFetch = vi
        .fn()
        .mockResolvedValue(Response.json({ ok: false, error: `invalid_${refreshToken}` }))

      const result = await withMockFetch(mockFetch, () => refreshOAuthToken('slack', refreshToken))

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).not.toContain(refreshToken)
        expect(result.errorCode).toBeUndefined()
      }
    })

    it.concurrent('uses canonical endpoints without following credential redirects', async () => {
      const mockFetch = createMockFetch(defaultOAuthResponse)

      await withMockFetch(mockFetch, () => refreshOAuthToken('google', 'test_refresh_token'))

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ redirect: 'error' })
      )
    })

    it.concurrent(
      'should reject oversized OAuth error responses without materializing them',
      async () => {
        const mockFetch = vi
          .fn()
          .mockResolvedValue(
            new Response('x'.repeat(DEFAULT_MAX_ERROR_BODY_BYTES + 1), { status: 400 })
          )

        const result = await withMockFetch(mockFetch, () =>
          refreshOAuthToken('google', 'test_refresh_token')
        )

        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.message).toContain('exceeds maximum size')
      }
    )
  })

  describe('Token Response Handling', () => {
    it.concurrent('should bound successful token responses before parsing them', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValue(new Response('x'.repeat(DEFAULT_MAX_ERROR_BODY_BYTES + 1)))

      const result = await withMockFetch(mockFetch, () =>
        refreshOAuthToken('google', 'test_refresh_token')
      )

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.message).toContain('exceeds maximum size')
    })

    it.concurrent('refreshes Monday with JSON body credentials and rotates its token', async () => {
      const expiresAtSeconds = Math.floor(Date.now() / 1000) + 2700
      const mockFetch = createMockFetch({
        json: {
          access_token: oauthTestJwt({ exp: expiresAtSeconds }),
          refresh_token: 'rotated-monday-refresh-token',
          token_type: 'Bearer',
          scope: 'boards:read me:read',
        },
      })

      const result = await withMockFetch(mockFetch, () =>
        refreshOAuthToken('monday', 'old-monday-refresh-token')
      )

      expect(result).toMatchObject({
        ok: true,
        refreshToken: 'rotated-monday-refresh-token',
      })
      if (result.ok) {
        expect(result.expiresIn).toBeGreaterThanOrEqual(2699)
        expect(result.expiresIn).toBeLessThanOrEqual(2700)
      }

      const [endpoint, request] = mockFetch.mock.calls[0] as [string, RequestInit]
      expect(endpoint).toBe('https://auth.monday.com/oauth_ms/oauth/token')
      expect(request.headers).toMatchObject({ 'Content-Type': 'application/json' })
      expect(JSON.parse(request.body as string)).toEqual({
        grant_type: 'refresh_token',
        refresh_token: 'old-monday-refresh-token',
        client_id: 'monday_client_id',
        client_secret: 'monday_client_secret',
      })
    })

    it.concurrent('rejects a Monday refresh response that omits token rotation', async () => {
      const mockFetch = createMockFetch({
        json: {
          access_token: oauthTestJwt({ exp: Math.floor(Date.now() / 1000) + 3600 }),
          token_type: 'Bearer',
        },
      })

      const result = await withMockFetch(mockFetch, () =>
        refreshOAuthToken('monday', 'old-monday-refresh-token')
      )

      expect(result).toEqual({
        ok: false,
        message: 'Invalid Monday token refresh response',
      })
    })

    it.concurrent('should use original refresh token when new one is not provided', async () => {
      const refreshToken = 'original_refresh_token'

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'new_access_token',
          expires_in: 3600,
        }),
      })

      const result = await withMockFetch(mockFetch, () => refreshOAuthToken('google', refreshToken))

      expect(result).toEqual({
        ok: true,
        accessToken: 'new_access_token',
        expiresIn: 3600,
        refreshToken: refreshToken,
      })
    })

    it.concurrent('should return failure when access token is missing', async () => {
      const refreshToken = 'test_refresh_token'

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          expires_in: 3600,
        }),
      })

      const result = await withMockFetch(mockFetch, () => refreshOAuthToken('google', refreshToken))

      expect(result.ok).toBe(false)
    })
  })

  describe('Instagram Token Refresh', () => {
    it.concurrent('validates and rotates the long-lived token response', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        Response.json({
          access_token: 'new_instagram_access_token',
          token_type: 'bearer',
          expires_in: 5_184_000,
        })
      )

      const result = await withMockFetch(mockFetch, () =>
        refreshOAuthToken('instagram', 'old_instagram_access_token')
      )

      expect(result).toEqual({
        ok: true,
        accessToken: 'new_instagram_access_token',
        expiresIn: 5_184_000,
        refreshToken: 'new_instagram_access_token',
      })
      expect(mockFetch).toHaveBeenCalledWith(
        'https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=old_instagram_access_token',
        expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) })
      )
    })

    it.concurrent('rejects malformed long-lived token response fields', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        Response.json({
          access_token: 'new_instagram_access_token',
          expires_in: '5184000',
        })
      )

      const result = await withMockFetch(mockFetch, () =>
        refreshOAuthToken('instagram', 'old_instagram_access_token')
      )

      expect(result).toEqual({
        ok: false,
        message: 'Invalid Instagram token refresh response',
      })
    })

    it.concurrent('extracts nested Meta error codes from a bounded response', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: { message: 'Invalid OAuth access token', type: 'OAuthException', code: 190 } },
            { status: 400 }
          )
        )

      const result = await withMockFetch(mockFetch, () =>
        refreshOAuthToken('instagram', 'old_instagram_access_token')
      )

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.errorCode).toBe('190')
    })
  })
})
