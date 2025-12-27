import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import { buildZendeskUrl, handleZendeskError } from './types'

const logger = createLogger('ZendeskGetUser')

export interface ZendeskGetUserParams {
  email: string
  apiToken: string
  subdomain: string
  userId: string
}

export interface ZendeskGetUserResponse {
  success: boolean
  output: {
    user: any
    metadata: {
      operation: 'get_user'
    }
    success: boolean
  }
}

export const zendeskGetUserTool: ToolConfig<ZendeskGetUserParams, ZendeskGetUserResponse> = {
  id: 'zendesk_get_user',
  name: 'Get Single User from Zendesk',
  description: 'Get a single user by ID from Zendesk',
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
      description: 'User ID to retrieve',
    },
  },

  request: {
    url: (params) => buildZendeskUrl(params.subdomain, `/users/${params.userId}`),
    method: 'GET',
    headers: (params) => {
      const credentials = `${params.email}/token:${params.apiToken}`
      const base64Credentials = Buffer.from(credentials).toString('base64')
      return {
        Authorization: `Basic ${base64Credentials}`,
        'Content-Type': 'application/json',
      }
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleZendeskError(data, response.status, 'get_user')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        user: data.user,
        metadata: {
          operation: 'get_user' as const,
        },
        success: true,
      },
    }
  },

  outputs: {
    user: { type: 'object', description: 'User object' },
    metadata: { type: 'object', description: 'Operation metadata' },
  },
}
