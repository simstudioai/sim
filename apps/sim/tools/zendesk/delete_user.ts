import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import { buildZendeskUrl, handleZendeskError } from './types'

const logger = createLogger('ZendeskDeleteUser')

export interface ZendeskDeleteUserParams {
  email: string
  apiToken: string
  subdomain: string
  userId: string
}

export interface ZendeskDeleteUserResponse {
  success: boolean
  output: {
    deleted: boolean
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
      email: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Your Zendesk email address',
      },
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
      headers: (params) => {
        const credentials = `${params.email}/token:${params.apiToken}`
        const base64Credentials = Buffer.from(credentials).toString('base64')
        return {
          Authorization: `Basic ${base64Credentials}`,
          'Content-Type': 'application/json',
        }
      },
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
          deleted: true,
          metadata: {
            operation: 'delete_user' as const,
            userId: params?.userId || '',
          },
          success: true,
        },
      }
    },

    outputs: {
      deleted: { type: 'boolean', description: 'Deletion success' },
      metadata: { type: 'object', description: 'Operation metadata' },
    },
  }
