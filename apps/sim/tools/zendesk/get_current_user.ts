import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import { buildZendeskUrl, handleZendeskError } from './types'

const logger = createLogger('ZendeskGetCurrentUser')

export interface ZendeskGetCurrentUserParams {
  email: string
  apiToken: string
  subdomain: string
}

export interface ZendeskGetCurrentUserResponse {
  success: boolean
  output: {
    user: any
    metadata: {
      operation: 'get_current_user'
    }
    success: boolean
  }
}

export const zendeskGetCurrentUserTool: ToolConfig<
  ZendeskGetCurrentUserParams,
  ZendeskGetCurrentUserResponse
> = {
  id: 'zendesk_get_current_user',
  name: 'Get Current User from Zendesk',
  description: 'Get the currently authenticated user from Zendesk',
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
  },

  request: {
    url: (params) => buildZendeskUrl(params.subdomain, '/users/me'),
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
      handleZendeskError(data, response.status, 'get_current_user')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        user: data.user,
        metadata: {
          operation: 'get_current_user' as const,
        },
        success: true,
      },
    }
  },

  outputs: {
    user: { type: 'object', description: 'Current user object' },
    metadata: { type: 'object', description: 'Operation metadata' },
  },
}
