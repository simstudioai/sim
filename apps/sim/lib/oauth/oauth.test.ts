import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

vi.mock('../env', () => ({
  env: {
    GOOGLE_CLIENT_ID: 'google_client_id',
    GOOGLE_CLIENT_SECRET: 'google_client_secret',
    GITHUB_CLIENT_ID: 'github_client_id',
    GITHUB_CLIENT_SECRET: 'github_client_secret',
    X_CLIENT_ID: 'x_client_id',
    X_CLIENT_SECRET: 'x_client_secret',
    CONFLUENCE_CLIENT_ID: 'confluence_client_id',
    CONFLUENCE_CLIENT_SECRET: 'confluence_client_secret',
    JIRA_CLIENT_ID: 'jira_client_id',
    JIRA_CLIENT_SECRET: 'jira_client_secret',
    AIRTABLE_CLIENT_ID: 'airtable_client_id',
    AIRTABLE_CLIENT_SECRET: 'airtable_client_secret',
    SUPABASE_CLIENT_ID: 'supabase_client_id',
    SUPABASE_CLIENT_SECRET: 'supabase_client_secret',
    NOTION_CLIENT_ID: 'notion_client_id',
    NOTION_CLIENT_SECRET: 'notion_client_secret',
    DISCORD_CLIENT_ID: 'discord_client_id',
    DISCORD_CLIENT_SECRET: 'discord_client_secret',
    MICROSOFT_CLIENT_ID: 'microsoft_client_id',
    MICROSOFT_CLIENT_SECRET: 'microsoft_client_secret',
    LINEAR_CLIENT_ID: 'linear_client_id',
    LINEAR_CLIENT_SECRET: 'linear_client_secret',
    SLACK_CLIENT_ID: 'slack_client_id',
    SLACK_CLIENT_SECRET: 'slack_client_secret',
    REDDIT_CLIENT_ID: 'reddit_client_id',
    REDDIT_CLIENT_SECRET: 'reddit_client_secret',
  },
}))

vi.mock('@/lib/logs/console-logger', () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}))

const mockFetch = vi.fn()
global.fetch = mockFetch

import { refreshOAuthToken } from './oauth'

describe('OAuth Token Refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'new_access_token',
        expires_in: 3600,
        refresh_token: 'new_refresh_token',
      }),
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('Basic Auth Providers', () => {
    const basicAuthProviders = [
      {
        name: 'Airtable',
        providerId: 'airtable',
        endpoint: 'https://airtable.com/oauth2/v1/token',
      },
      { name: 'X (Twitter)', providerId: 'x', endpoint: 'https://api.x.com/2/oauth2/token' },
      {
        name: 'Confluence',
        providerId: 'confluence',
        endpoint: 'https://auth.atlassian.com/oauth/token',
      },
      { name: 'Jira', providerId: 'jira', endpoint: 'https://auth.atlassian.com/oauth/token' },
      {
        name: 'Discord',
        providerId: 'discord',
        endpoint: 'https://discord.com/api/v10/oauth2/token',
      },
      { name: 'Linear', providerId: 'linear', endpoint: 'https://api.linear.app/oauth/token' },
      {
        name: 'Reddit',
        providerId: 'reddit',
        endpoint: 'https://www.reddit.com/api/v1/access_token',
      },
    ]

    basicAuthProviders.forEach(({ name, providerId, endpoint }) => {
      it(`should send ${name} request with Basic Auth header and no credentials in body`, async () => {
        const refreshToken = 'test_refresh_token'

        await refreshOAuthToken(providerId, refreshToken)

        expect(mockFetch).toHaveBeenCalledWith(
          endpoint,
          expect.objectContaining({
            method: 'POST',
            headers: expect.objectContaining({
              'Content-Type': 'application/x-www-form-urlencoded',
              Authorization: expect.stringMatching(/^Basic /),
            }),
            body: expect.any(String),
          })
        )

        const [, requestOptions] = (mockFetch as Mock).mock.calls[0]

        // Verify Basic Auth header
        const authHeader = requestOptions.headers.Authorization
        expect(authHeader).toMatch(/^Basic /)

        // Decode and verify credentials
        const base64Credentials = authHeader.replace('Basic ', '')
        const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8')
        const [clientId, clientSecret] = credentials.split(':')

        expect(clientId).toBe(`${providerId}_client_id`)
        expect(clientSecret).toBe(`${providerId}_client_secret`)

        // Verify body contains only required parameters
        const bodyParams = new URLSearchParams(requestOptions.body)
        const bodyKeys = Array.from(bodyParams.keys())

        expect(bodyKeys).toEqual(['grant_type', 'refresh_token'])
        expect(bodyParams.get('grant_type')).toBe('refresh_token')
        expect(bodyParams.get('refresh_token')).toBe(refreshToken)

        // Verify client credentials are NOT in the body
        expect(bodyParams.get('client_id')).toBeNull()
        expect(bodyParams.get('client_secret')).toBeNull()
      })
    })
  })

  describe('Body Credential Providers', () => {
    const bodyCredentialProviders = [
      { name: 'Google', providerId: 'google', endpoint: 'https://oauth2.googleapis.com/token' },
      {
        name: 'GitHub',
        providerId: 'github',
        endpoint: 'https://github.com/login/oauth/access_token',
      },
      {
        name: 'Microsoft',
        providerId: 'microsoft',
        endpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      },
      {
        name: 'Outlook',
        providerId: 'outlook',
        endpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      },
      {
        name: 'Supabase',
        providerId: 'supabase',
        endpoint: 'https://api.supabase.com/v1/oauth/token',
      },
      { name: 'Notion', providerId: 'notion', endpoint: 'https://api.notion.com/v1/oauth/token' },
      { name: 'Slack', providerId: 'slack', endpoint: 'https://slack.com/api/oauth.v2.access' },
    ]

    bodyCredentialProviders.forEach(({ name, providerId, endpoint }) => {
      it(`should send ${name} request with credentials in body and no Basic Auth`, async () => {
        const refreshToken = 'test_refresh_token'

        await refreshOAuthToken(providerId, refreshToken)

        expect(mockFetch).toHaveBeenCalledWith(
          endpoint,
          expect.objectContaining({
            method: 'POST',
            headers: expect.objectContaining({
              'Content-Type': 'application/x-www-form-urlencoded',
            }),
            body: expect.any(String),
          })
        )

        const [, requestOptions] = (mockFetch as Mock).mock.calls[0]

        // Verify no Basic Auth header
        expect(requestOptions.headers.Authorization).toBeUndefined()

        // Verify body contains all required parameters
        const bodyParams = new URLSearchParams(requestOptions.body)
        const bodyKeys = Array.from(bodyParams.keys()).sort()

        expect(bodyKeys).toEqual(['client_id', 'client_secret', 'grant_type', 'refresh_token'])
        expect(bodyParams.get('grant_type')).toBe('refresh_token')
        expect(bodyParams.get('refresh_token')).toBe(refreshToken)

        // Verify client credentials are in the body
        const expectedClientId =
          providerId === 'outlook' ? 'microsoft_client_id' : `${providerId}_client_id`
        const expectedClientSecret =
          providerId === 'outlook' ? 'microsoft_client_secret' : `${providerId}_client_secret`

        expect(bodyParams.get('client_id')).toBe(expectedClientId)
        expect(bodyParams.get('client_secret')).toBe(expectedClientSecret)
      })
    })

    it('should include Accept header for GitHub requests', async () => {
      const refreshToken = 'test_refresh_token'

      await refreshOAuthToken('github', refreshToken)

      const [, requestOptions] = (mockFetch as Mock).mock.calls[0]
      expect(requestOptions.headers.Accept).toBe('application/json')
    })
  })

  describe('Error Handling', () => {
    it('should return null for unsupported provider', async () => {
      const refreshToken = 'test_refresh_token'

      const result = await refreshOAuthToken('unsupported', refreshToken)

      expect(result).toBeNull()
    })

    it('should return null for API error responses', async () => {
      const refreshToken = 'test_refresh_token'

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () =>
          JSON.stringify({
            error: 'invalid_request',
            error_description: 'Invalid refresh token',
          }),
      })

      const result = await refreshOAuthToken('google', refreshToken)

      expect(result).toBeNull()
    })

    it('should return null for network errors', async () => {
      const refreshToken = 'test_refresh_token'

      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const result = await refreshOAuthToken('google', refreshToken)

      expect(result).toBeNull()
    })
  })

  describe('Token Response Handling', () => {
    it('should handle providers that return new refresh tokens', async () => {
      const refreshToken = 'old_refresh_token'
      const newRefreshToken = 'new_refresh_token'

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new_access_token',
          expires_in: 3600,
          refresh_token: newRefreshToken,
        }),
      })

      const result = await refreshOAuthToken('airtable', refreshToken)

      expect(result).toEqual({
        accessToken: 'new_access_token',
        expiresIn: 3600,
        refreshToken: newRefreshToken,
      })
    })

    it('should use original refresh token when new one is not provided', async () => {
      const refreshToken = 'original_refresh_token'

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new_access_token',
          expires_in: 3600,
          // No refresh_token in response
        }),
      })

      const result = await refreshOAuthToken('google', refreshToken)

      expect(result).toEqual({
        accessToken: 'new_access_token',
        expiresIn: 3600,
        refreshToken: refreshToken,
      })
    })

    it('should return null when access token is missing', async () => {
      const refreshToken = 'test_refresh_token'

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          expires_in: 3600,
          // No access_token in response
        }),
      })

      const result = await refreshOAuthToken('google', refreshToken)

      expect(result).toBeNull()
    })

    it('should use default expiration when not provided', async () => {
      const refreshToken = 'test_refresh_token'

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new_access_token',
          // No expires_in in response
        }),
      })

      const result = await refreshOAuthToken('google', refreshToken)

      expect(result).toEqual({
        accessToken: 'new_access_token',
        expiresIn: 3600,
        refreshToken: refreshToken,
      })
    })
  })

  describe('Airtable Tests', () => {
    it('should not have duplicate client ID issue', async () => {
      const refreshToken = 'test_refresh_token'

      await refreshOAuthToken('airtable', refreshToken)

      const [, requestOptions] = (mockFetch as Mock).mock.calls[0]

      // Verify Authorization header is present and correct
      expect(requestOptions.headers.Authorization).toMatch(/^Basic /)

      // Parse body and verify client credentials are NOT present
      const bodyParams = new URLSearchParams(requestOptions.body)
      expect(bodyParams.get('client_id')).toBeNull()
      expect(bodyParams.get('client_secret')).toBeNull()

      // Verify only expected parameters are present
      const bodyKeys = Array.from(bodyParams.keys())
      expect(bodyKeys).toEqual(['grant_type', 'refresh_token'])
    })

    it('should handle Airtable refresh token rotation', async () => {
      const refreshToken = 'old_refresh_token'
      const newRefreshToken = 'rotated_refresh_token'

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new_access_token',
          expires_in: 3600,
          refresh_token: newRefreshToken,
        }),
      })

      const result = await refreshOAuthToken('airtable', refreshToken)

      expect(result?.refreshToken).toBe(newRefreshToken)
    })
  })
})
