import type { ToolConfig } from '@/tools/types'
import { buildZendeskUrl, handleZendeskError } from '@/tools/zendesk/types'

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
    user_id: string
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
        visibility: 'user-or-llm',
        description: 'User ID to delete as a numeric string (e.g., "12345")',
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
          user_id: params?.userId || '',
          success: true,
        },
      }
    },

    outputs: {
      deleted: { type: 'boolean', description: 'Deletion success' },
      user_id: { type: 'string', description: 'The deleted user ID' },
    },
  }
