import { createLogger } from '@sim/logger'
import type {
  ClerkApiError,
  ClerkListSessionsParams,
  ClerkListSessionsResponse,
  ClerkSession,
} from '@/tools/clerk/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ClerkListSessions')

export const clerkListSessionsTool: ToolConfig<ClerkListSessionsParams, ClerkListSessionsResponse> =
  {
    id: 'clerk_list_sessions',
    name: 'List Sessions from Clerk',
    description: 'List sessions for a user or client in your Clerk application',
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
        required: false,
        visibility: 'user-or-llm',
        description:
          'User ID to list sessions for (e.g., user_2NNEqL2nrIRdJ194ndJqAHwEfxC; required if clientId not provided)',
      },
      clientId: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Client ID to list sessions for (required if userId not provided)',
      },
      status: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Filter by session status (abandoned, active, ended, expired, pending, removed, replaced, revoked)',
      },
      limit: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Number of results per page (e.g., 10, 50, 100; range: 1-500, default: 10)',
      },
      offset: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Number of results to skip for pagination (e.g., 0, 10, 20)',
      },
    },

    request: {
      url: (params) => {
        const queryParams = new URLSearchParams()

        if (params.userId) queryParams.append('user_id', params.userId)
        if (params.clientId) queryParams.append('client_id', params.clientId)
        if (params.status) queryParams.append('status', params.status)
        if (params.limit) queryParams.append('limit', params.limit.toString())
        if (params.offset) queryParams.append('offset', params.offset.toString())

        const queryString = queryParams.toString()
        return queryString
          ? `https://api.clerk.com/v1/sessions?${queryString}`
          : 'https://api.clerk.com/v1/sessions'
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
      const data: ClerkSession[] | ClerkApiError = await response.json()

      if (!response.ok) {
        logger.error('Clerk API request failed', { data, status: response.status })
        throw new Error(
          (data as ClerkApiError).errors?.[0]?.message || 'Failed to list sessions from Clerk'
        )
      }

      const totalCount = Number.parseInt(response.headers.get('x-total-count') || '0', 10)

      const sessions = (data as ClerkSession[]).map((session) => ({
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
      }))

      return {
        success: true,
        output: {
          sessions,
          totalCount: totalCount || sessions.length,
          success: true,
        },
      }
    },

    outputs: {
      sessions: {
        type: 'array',
        description: 'Array of Clerk session objects',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Session ID' },
            userId: { type: 'string', description: 'User ID' },
            clientId: { type: 'string', description: 'Client ID' },
            status: { type: 'string', description: 'Session status' },
            lastActiveAt: {
              type: 'number',
              description: 'Last activity timestamp',
              optional: true,
            },
            lastActiveOrganizationId: {
              type: 'string',
              description: 'Last active organization ID',
              optional: true,
            },
            expireAt: { type: 'number', description: 'Expiration timestamp', optional: true },
            abandonAt: { type: 'number', description: 'Abandon timestamp', optional: true },
            createdAt: { type: 'number', description: 'Creation timestamp' },
            updatedAt: { type: 'number', description: 'Last update timestamp' },
          },
        },
      },
      totalCount: { type: 'number', description: 'Total number of sessions' },
      success: { type: 'boolean', description: 'Operation success status' },
    },
  }
