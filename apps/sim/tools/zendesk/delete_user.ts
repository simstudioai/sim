import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import { buildZendeskUrl, handleZendeskError } from './types'

const logger = createLogger('ZendeskDeleteUser')

export interface ZendeskDeleteUserParams {
  apiToken: string
  subdomain: string
  userId: string
}

export interface ZendeskDeleteUserResponse {
  success: boolean
  output: {
    user: any
    metadata: {
      operation: 'delete_user'
      userId: string
    }
    success: boolean
  }
}

export const zendeskDeleteUserTool: ToolConfig<ZendeskDeleteUserParams, ZendeskDeleteUserResponse> =
  {
    id: 'zendesk_delete_user',
    name: 'Delete User from Zendesk',
    description: 'Delete a user from Zendesk',
    version: '1.0.0',

    params: {
      apiToken: {
        type: 'string',
        required: true,
        visibility: 'hidden',
        description: 'Zendesk API token',
      },
      subdomain: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Your Zendesk subdomain',
      },
      userId: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'User ID to delete',
      },
    },

    request: {
      url: (params) => buildZendeskUrl(params.subdomain, `/users/${params.userId}`),
      method: 'DELETE',
      headers: (params) => ({
        Authorization: `Bearer ${params.apiToken}`,
        'Content-Type': 'application/json',
      }),
    },

    transformResponse: async (response: Response, params) => {
      if (!response.ok) {
        const data = await response.json()
        handleZendeskError(data, response.status, 'delete_user')
      }

      // DELETE returns 204 No Content with empty body
      return {
        success: true,
        output: {
          user: null,
          metadata: {
            operation: 'delete_user' as const,
            userId: params?.userId || '',
          },
          success: true,
        },
      }
    },

    outputs: {
      success: { type: 'boolean', description: 'Operation success status' },
      output: {
        type: 'object',
        description: 'Deleted user data',
        properties: {
          user: { type: 'object', description: 'Deleted user object' },
          metadata: { type: 'object', description: 'Operation metadata' },
          success: { type: 'boolean', description: 'Operation success' },
        },
      },
    },
  }
