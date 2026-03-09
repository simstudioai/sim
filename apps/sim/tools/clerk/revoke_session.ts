import { createLogger } from '@sim/logger'
import type {
  ClerkApiError,
  ClerkRevokeSessionParams,
  ClerkRevokeSessionResponse,
  ClerkSession,
} from '@/tools/clerk/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ClerkRevokeSession')

export const clerkRevokeSessionTool: ToolConfig<
  ClerkRevokeSessionParams,
  ClerkRevokeSessionResponse
> = {
  id: 'clerk_revoke_session',
  name: 'Revoke Session in Clerk',
  description: 'Revoke a session to immediately invalidate it',
  version: '1.0.0',

  params: {
    secretKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The Clerk Secret Key for API authentication',
    },
    sessionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the session to revoke (e.g., sess_2NNEqL2nrIRdJ194ndJqAHwEfxC)',
    },
  },

  request: {
    url: (params) => `https://api.clerk.com/v1/sessions/${params.sessionId}/revoke`,
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
    const data: ClerkSession | ClerkApiError = await response.json()

    if (!response.ok) {
      logger.error('Clerk API request failed', { data, status: response.status })
      throw new Error(
        (data as ClerkApiError).errors?.[0]?.message || 'Failed to revoke session in Clerk'
      )
    }

    const session = data as ClerkSession
    return {
      success: true,
      output: {
        id: session.id,
        userId: session.user_id,
        clientId: session.client_id,
        status: session.status,
        lastActiveAt: session.last_active_at ?? null,
        lastActiveOrganizationId: session.last_active_organization_id ?? null,
        expireAt: session.expire_at ?? null,
        abandonAt: session.abandon_at ?? null,
        createdAt: session.created_at,
        updatedAt: session.updated_at,
        success: true,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Session ID' },
    userId: { type: 'string', description: 'User ID' },
    clientId: { type: 'string', description: 'Client ID' },
    status: { type: 'string', description: 'Session status (should be revoked)' },
    lastActiveAt: { type: 'number', description: 'Last activity timestamp', optional: true },
    lastActiveOrganizationId: {
      type: 'string',
      description: 'Last active organization ID',
      optional: true,
    },
    expireAt: { type: 'number', description: 'Expiration timestamp', optional: true },
    abandonAt: { type: 'number', description: 'Abandon timestamp', optional: true },
    createdAt: { type: 'number', description: 'Creation timestamp' },
    updatedAt: { type: 'number', description: 'Last update timestamp' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
