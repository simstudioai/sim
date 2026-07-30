import { createLogger } from '@sim/logger'
import type {
  ClerkActorToken,
  ClerkApiError,
  ClerkCreateActorTokenParams,
  ClerkCreateActorTokenResponse,
} from '@/tools/clerk/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ClerkCreateActorToken')

export const clerkCreateActorTokenTool: ToolConfig<
  ClerkCreateActorTokenParams,
  ClerkCreateActorTokenResponse
> = {
  id: 'clerk_create_actor_token',
  name: 'Create Actor Token in Clerk',
  description:
    'Create an actor token to impersonate a user (God Mode / act-as-user), e.g. for support tooling',
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
      description: 'ID of the user to impersonate',
    },
    actor: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Actor JSON object identifying who is impersonating, must include a "sub" field, e.g. {"sub": "user_support_agent_id"}',
    },
    expiresInSeconds: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Seconds until the token expires (default 3600)',
    },
    sessionMaxDurationInSeconds: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Max duration in seconds for sessions created with this token (default 1800)',
    },
  },

  request: {
    url: () => 'https://api.clerk.com/v1/actor_tokens',
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
    body: (params) => {
      const body: Record<string, unknown> = {
        user_id: params.userId?.trim(),
        actor: params.actor,
      }

      if (params.expiresInSeconds !== undefined) body.expires_in_seconds = params.expiresInSeconds
      if (params.sessionMaxDurationInSeconds !== undefined)
        body.session_max_duration_in_seconds = params.sessionMaxDurationInSeconds

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data: ClerkActorToken | ClerkApiError = await response.json()

    if (!response.ok) {
      logger.error('Clerk API request failed', { data, status: response.status })
      throw new Error(
        (data as ClerkApiError).errors?.[0]?.message || 'Failed to create actor token in Clerk'
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
    status: { type: 'string', description: 'Actor token status' },
    userId: { type: 'string', description: 'ID of the impersonated user' },
    actor: { type: 'json', description: 'Actor object identifying who is impersonating' },
    token: { type: 'string', description: 'Signed actor token (JWT)', optional: true },
    url: { type: 'string', description: 'Sign-in URL for the actor token', optional: true },
    createdAt: { type: 'number', description: 'Creation timestamp' },
    updatedAt: { type: 'number', description: 'Last update timestamp' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
