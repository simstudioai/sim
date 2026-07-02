import { createLogger } from '@sim/logger'
import type {
  ClerkApiError,
  ClerkGetUserOauthTokenParams,
  ClerkGetUserOauthTokenResponse,
  ClerkOAuthAccessToken,
} from '@/tools/clerk/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ClerkGetUserOauthToken')

export const clerkGetUserOauthTokenTool: ToolConfig<
  ClerkGetUserOauthTokenParams,
  ClerkGetUserOauthTokenResponse
> = {
  id: 'clerk_get_user_oauth_token',
  name: 'Get User OAuth Access Token from Clerk',
  description:
    "Retrieve a user's OAuth access token for a connected external provider (e.g. Google, GitHub, Microsoft) obtained via Clerk SSO",
  version: '1.0.0',

  params: {
    secretKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The Clerk Secret Key for API authentication',
    },
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the user (e.g., user_2NNEqL2nrIRdJ194ndJqAHwEfxC)',
    },
    provider: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'OAuth provider slug, e.g. google, github, microsoft, discord (without the oauth_ prefix)',
    },
  },

  request: {
    url: (params) => {
      const providerSlug = params.provider?.trim().replace(/^oauth_/, '')
      return `https://api.clerk.com/v1/users/${params.userId?.trim()}/oauth_access_tokens/oauth_${providerSlug}`
    },
    method: 'GET',
    headers: (params) => {
      if (!params.secretKey) {
        throw new Error('Clerk Secret Key is required')
      }
      return {
        Authorization: `Bearer ${params.secretKey}`,
        'Content-Type': 'application/json',
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data: ClerkOAuthAccessToken[] | ClerkApiError = await response.json()

    if (!response.ok) {
      logger.error('Clerk API request failed', { data, status: response.status })
      throw new Error(
        (data as ClerkApiError).errors?.[0]?.message ||
          'Failed to get user OAuth access token from Clerk'
      )
    }

    const tokens = data as ClerkOAuthAccessToken[]
    return {
      success: true,
      output: {
        accessTokens: tokens.map((token) => ({
          externalAccountId: token.external_account_id,
          token: token.token,
          expiresAt: token.expires_at ?? null,
          provider: token.provider,
          label: token.label ?? null,
          scopes: token.scopes ?? [],
        })),
        success: true,
      },
    }
  },

  outputs: {
    accessTokens: {
      type: 'array',
      description: 'OAuth access tokens for the connected provider',
      items: {
        type: 'object',
        properties: {
          externalAccountId: { type: 'string', description: 'External account ID' },
          token: { type: 'string', description: 'OAuth access token' },
          expiresAt: { type: 'number', description: 'Expiration timestamp', optional: true },
          provider: { type: 'string', description: 'OAuth provider slug' },
          label: { type: 'string', description: 'Token label', optional: true },
          scopes: {
            type: 'array',
            description: 'OAuth scopes granted to the token',
            items: { type: 'string' },
          },
        },
      },
    },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
