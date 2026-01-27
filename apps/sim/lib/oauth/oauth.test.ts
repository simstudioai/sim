import { createEnvMock, createMockFetch, loggerMock } from '@sim/testing'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/config/env', () =>
  createEnvMock({
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
    NOTION_CLIENT_ID: 'notion_client_id',
    NOTION_CLIENT_SECRET: 'notion_client_secret',
    MICROSOFT_CLIENT_ID: 'microsoft_client_id',
    MICROSOFT_CLIENT_SECRET: 'microsoft_client_secret',
    LINEAR_CLIENT_ID: 'linear_client_id',
    LINEAR_CLIENT_SECRET: 'linear_client_secret',
    SLACK_CLIENT_ID: 'slack_client_id',
    SLACK_CLIENT_SECRET: 'slack_client_secret',
    REDDIT_CLIENT_ID: 'reddit_client_id',
    REDDIT_CLIENT_SECRET: 'reddit_client_secret',
    DROPBOX_CLIENT_ID: 'dropbox_client_id',
    DROPBOX_CLIENT_SECRET: 'dropbox_client_secret',
    WEALTHBOX_CLIENT_ID: 'wealthbox_client_id',
    WEALTHBOX_CLIENT_SECRET: 'wealthbox_client_secret',
    WEBFLOW_CLIENT_ID: 'webflow_client_id',
    WEBFLOW_CLIENT_SECRET: 'webflow_client_secret',
    ASANA_CLIENT_ID: 'asana_client_id',
    ASANA_CLIENT_SECRET: 'asana_client_secret',
    PIPEDRIVE_CLIENT_ID: 'pipedrive_client_id',
    PIPEDRIVE_CLIENT_SECRET: 'pipedrive_client_secret',
    HUBSPOT_CLIENT_ID: 'hubspot_client_id',
    HUBSPOT_CLIENT_SECRET: 'hubspot_client_secret',
    LINKEDIN_CLIENT_ID: 'linkedin_client_id',
    LINKEDIN_CLIENT_SECRET: 'linkedin_client_secret',
    SALESFORCE_CLIENT_ID: 'salesforce_client_id',
    SALESFORCE_CLIENT_SECRET: 'salesforce_client_secret',
    SHOPIFY_CLIENT_ID: 'shopify_client_id',
    SHOPIFY_CLIENT_SECRET: 'shopify_client_secret',
    ZOOM_CLIENT_ID: 'zoom_client_id',
    ZOOM_CLIENT_SECRET: 'zoom_client_secret',
    WORDPRESS_CLIENT_ID: 'wordpress_client_id',
    WORDPRESS_CLIENT_SECRET: 'wordpress_client_secret',
    SPOTIFY_CLIENT_ID: 'spotify_client_id',
    SPOTIFY_CLIENT_SECRET: 'spotify_client_secret',
  })
)

vi.mock('@sim/logger', () => loggerMock)

import { refreshOAuthToken } from '@/lib/oauth'

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

/**
 * Helper to run a function with a mocked global fetch.
 */
function withMockFetch<T>(mockFetch: ReturnType<typeof vi.fn>, fn: () => Promise<T>): Promise<T> {
  const originalFetch = global.fetch
  global.fetch = mockFetch
  return fn().finally(() => {
    global.fetch = originalFetch
  })
}

describe('OAuth Token Refresh', () => {
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
      { name: 'Linear', providerId: 'linear', endpoint: 'https://api.linear.app/oauth/token' },
      {
        name: 'Reddit',
        providerId: 'reddit',
        endpoint: 'https://www.reddit.com/api/v1/access_token',
      },
      {
        name: 'Asana',
        providerId: 'asana',
        endpoint: 'https://app.asana.com/-/oauth_token',
      },
      {
        name: 'Zoom',
        providerId: 'zoom',
        endpoint: 'https://zoom.us/oauth/token',
      },
      {
        name: 'Spotify',
        providerId: 'spotify',
        endpoint: 'https://accounts.spotify.com/api/token',
      },
    ]

    basicAuthProviders.forEach(({ name, providerId, endpoint }) => {
      it.concurrent(
        `should send ${name} request with Basic Auth header and no credentials in body`,
        async () => {
          const mockFetch = createMockFetch(defaultOAuthResponse)
          const refreshToken = 'test_refresh_token'

          await withMockFetch(mockFetch, () => refreshOAuthToken(providerId, refreshToken))

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

          const [, requestOptions] = mockFetch.mock.calls[0] as [
            string,
            { headers: Record<string, string>; body: string },
          ]

          const authHeader = requestOptions.headers.Authorization
          expect(authHeader).toMatch(/^Basic /)

          const base64Credentials = authHeader.replace('Basic ', '')
          const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8')
          const [clientId, clientSecret] = credentials.split(':')

          expect(clientId).toBe(`${providerId}_client_id`)
          expect(clientSecret).toBe(`${providerId}_client_secret`)

          const bodyParams = new URLSearchParams(requestOptions.body)
          const bodyKeys = Array.from(bodyParams.keys())

          expect(bodyKeys).toEqual(['grant_type', 'refresh_token'])
          expect(bodyParams.get('grant_type')).toBe('refresh_token')
          expect(bodyParams.get('refresh_token')).toBe(refreshToken)

          expect(bodyParams.get('client_id')).toBeNull()
          expect(bodyParams.get('client_secret')).toBeNull()
        }
      )
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
      { name: 'Notion', providerId: 'notion', endpoint: 'https://api.notion.com/v1/oauth/token' },
      { name: 'Slack', providerId: 'slack', endpoint: 'https://slack.com/api/oauth.v2.access' },
      {
        name: 'Dropbox',
        providerId: 'dropbox',
        endpoint: 'https://api.dropboxapi.com/oauth2/token',
      },
      {
        name: 'Wealthbox',
        providerId: 'wealthbox',
        endpoint: 'https://app.crmworkspace.com/oauth/token',
      },
      {
        name: 'Webflow',
        providerId: 'webflow',
        endpoint: 'https://api.webflow.com/oauth/access_token',
      },
      {
        name: 'Pipedrive',
        providerId: 'pipedrive',
        endpoint: 'https://oauth.pipedrive.com/oauth/token',
      },
      {
        name: 'HubSpot',
        providerId: 'hubspot',
        endpoint: 'https://api.hubapi.com/oauth/v1/token',
      },
      {
        name: 'LinkedIn',
        providerId: 'linkedin',
        endpoint: 'https://www.linkedin.com/oauth/v2/accessToken',
      },
      {
        name: 'Salesforce',
        providerId: 'salesforce',
        endpoint: 'https://login.salesforce.com/services/oauth2/token',
      },
      {
        name: 'Shopify',
        providerId: 'shopify',
        endpoint: 'https://accounts.shopify.com/oauth/token',
      },
      {
        name: 'WordPress',
        providerId: 'wordpress',
        endpoint: 'https://public-api.wordpress.com/oauth2/token',
      },
    ]

    bodyCredentialProviders.forEach(({ name, providerId, endpoint }) => {
      it.concurrent(
        `should send ${name} request with credentials in body and no Basic Auth`,
        async () => {
          const mockFetch = createMockFetch(defaultOAuthResponse)
          const refreshToken = 'test_refresh_token'

          await withMockFetch(mockFetch, () => refreshOAuthToken(providerId, refreshToken))

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

          const [, requestOptions] = mockFetch.mock.calls[0] as [
            string,
            { headers: Record<string, string>; body: string },
          ]

          expect(requestOptions.headers.Authorization).toBeUndefined()

          const bodyParams = new URLSearchParams(requestOptions.body)
          const bodyKeys = Array.from(bodyParams.keys()).sort()

          expect(bodyKeys).toEqual(['client_id', 'client_secret', 'grant_type', 'refresh_token'])
          expect(bodyParams.get('grant_type')).toBe('refresh_token')
          expect(bodyParams.get('refresh_token')).toBe(refreshToken)

          const expectedClientId =
            providerId === 'outlook' ? 'microsoft_client_id' : `${providerId}_client_id`
          const expectedClientSecret =
            providerId === 'outlook' ? 'microsoft_client_secret' : `${providerId}_client_secret`

          expect(bodyParams.get('client_id')).toBe(expectedClientId)
          expect(bodyParams.get('client_secret')).toBe(expectedClientSecret)
        }
      )
    })

    it.concurrent('should include Accept header for GitHub requests', async () => {
      const mockFetch = createMockFetch(defaultOAuthResponse)
      const refreshToken = 'test_refresh_token'

      await withMockFetch(mockFetch, () => refreshOAuthToken('github', refreshToken))

      const [, requestOptions] = mockFetch.mock.calls[0] as [
        string,
        { headers: Record<string, string>; body: string },
      ]
      expect(requestOptions.headers.Accept).toBe('application/json')
    })

    it.concurrent('should include User-Agent header for Reddit requests', async () => {
      const mockFetch = createMockFetch(defaultOAuthResponse)
      const refreshToken = 'test_refresh_token'

      await withMockFetch(mockFetch, () => refreshOAuthToken('reddit', refreshToken))

      const [, requestOptions] = mockFetch.mock.calls[0] as [
        string,
        { headers: Record<string, string>; body: string },
      ]
      expect(requestOptions.headers['User-Agent']).toBe(
        'sim-studio/1.0 (https://github.com/simstudioai/sim)'
      )
    })
  })

  describe('Error Handling', () => {
    it.concurrent('should return null for unsupported provider', async () => {
      const mockFetch = createMockFetch(defaultOAuthResponse)
      const refreshToken = 'test_refresh_token'

      const result = await withMockFetch(mockFetch, () =>
        refreshOAuthToken('unsupported', refreshToken)
      )

      expect(result).toBeNull()
    })

    it.concurrent('should return null for API error responses', async () => {
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

      expect(result).toBeNull()
    })

    it.concurrent('should return null for network errors', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'))
      const refreshToken = 'test_refresh_token'

      const result = await withMockFetch(mockFetch, () => refreshOAuthToken('google', refreshToken))

      expect(result).toBeNull()
    })
  })

  describe('Token Response Handling', () => {
    it.concurrent('should handle providers that return new refresh tokens', async () => {
      const refreshToken = 'old_refresh_token'
      const newRefreshToken = 'new_refresh_token'

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'new_access_token',
          expires_in: 3600,
          refresh_token: newRefreshToken,
        }),
      })

      const result = await withMockFetch(mockFetch, () =>
        refreshOAuthToken('airtable', refreshToken)
      )

      expect(result).toEqual({
        accessToken: 'new_access_token',
        expiresIn: 3600,
        refreshToken: newRefreshToken,
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
        accessToken: 'new_access_token',
        expiresIn: 3600,
        refreshToken: refreshToken,
      })
    })

    it.concurrent('should return null when access token is missing', async () => {
      const refreshToken = 'test_refresh_token'

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          expires_in: 3600,
        }),
      })

      const result = await withMockFetch(mockFetch, () => refreshOAuthToken('google', refreshToken))

      expect(result).toBeNull()
    })

    it.concurrent('should use default expiration when not provided', async () => {
      const refreshToken = 'test_refresh_token'

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'new_access_token',
        }),
      })

      const result = await withMockFetch(mockFetch, () => refreshOAuthToken('google', refreshToken))

      expect(result).toEqual({
        accessToken: 'new_access_token',
        expiresIn: 3600,
        refreshToken: refreshToken,
      })
    })
  })
})
