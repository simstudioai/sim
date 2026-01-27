import { createLogger } from '@sim/logger'
import type { ClerkRevokeSessionParams, ClerkRevokeSessionResponse } from '@/tools/clerk/types'
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
      description: 'The ID of the session to revoke',
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
    const data = await response.json()

    if (!response.ok) {
      logger.error('Clerk API request failed', { data, status: response.status })
      throw new Error(data.errors?.[0]?.message || 'Failed to revoke session in Clerk')
    }

    return {
      success: true,
      output: {
        id: data.id,
        userId: data.user_id,
        clientId: data.client_id,
        status: data.status,
        lastActiveAt: data.last_active_at ?? null,
        lastActiveOrganizationId: data.last_active_organization_id ?? null,
        expireAt: data.expire_at ?? null,
        abandonAt: data.abandon_at ?? null,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
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
