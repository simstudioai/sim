import { createLogger } from '@sim/logger'
import type {
  ClerkActorToken,
  ClerkApiError,
  ClerkRevokeActorTokenParams,
  ClerkRevokeActorTokenResponse,
} from '@/tools/clerk/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ClerkRevokeActorToken')

export const clerkRevokeActorTokenTool: ToolConfig<
  ClerkRevokeActorTokenParams,
  ClerkRevokeActorTokenResponse
> = {
  id: 'clerk_revoke_actor_token',
  name: 'Revoke Actor Token in Clerk',
  description: 'Revoke an actor token before it is used or expires',
  version: '1.0.0',

  params: {
    secretKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The Clerk Secret Key for API authentication',
    },
    actorTokenId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the actor token to revoke',
    },
  },

  request: {
    url: (params) => `https://api.clerk.com/v1/actor_tokens/${params.actorTokenId?.trim()}/revoke`,
    method: 'POST',
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
    const data: ClerkActorToken | ClerkApiError = await response.json()

    if (!response.ok) {
      logger.error('Clerk API request failed', { data, status: response.status })
      throw new Error(
        (data as ClerkApiError).errors?.[0]?.message || 'Failed to revoke actor token in Clerk'
      )
    }

    const actorToken = data as ClerkActorToken

    return {
      success: true,
      output: {
        id: actorToken.id,
        status: actorToken.status,
        userId: actorToken.user_id,
        actor: actorToken.actor ?? {},
        token: actorToken.token ?? null,
        url: actorToken.url ?? null,
        createdAt: actorToken.created_at,
        updatedAt: actorToken.updated_at,
        success: true,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Actor token ID' },
    status: { type: 'string', description: 'Actor token status (should be revoked)' },
    userId: { type: 'string', description: 'ID of the impersonated user' },
    actor: { type: 'json', description: 'Actor object identifying who is impersonating' },
    token: { type: 'string', description: 'Signed actor token (JWT)', optional: true },
    url: { type: 'string', description: 'Sign-in URL for the actor token', optional: true },
    createdAt: { type: 'number', description: 'Creation timestamp' },
    updatedAt: { type: 'number', description: 'Last update timestamp' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
