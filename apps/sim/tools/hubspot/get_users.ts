import { createLogger } from '@/lib/logs/console/logger'
import type { HubSpotGetUsersParams, HubSpotGetUsersResponse } from '@/tools/hubspot/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('HubSpotGetUsers')

export const hubspotGetUsersTool: ToolConfig<HubSpotGetUsersParams, HubSpotGetUsersResponse> = {
  id: 'hubspot_get_users',
  name: 'Get Users from HubSpot',
  description: 'Retrieve all users from HubSpot account',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'hubspot',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the HubSpot API',
    },
    limit: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Number of results to return (default: 100)',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = 'https://api.hubapi.com/crm/v3/objects/users'
      const queryParams = new URLSearchParams()

      if (params.limit) {
        queryParams.append('limit', params.limit)
      }

      const queryString = queryParams.toString()
      return queryString ? `${baseUrl}?${queryString}` : baseUrl
    },
    method: 'GET',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
  },

  transformResponse: async (response: Response, params) => {
    const data = await response.json()

    if (!response.ok) {
      logger.error('HubSpot API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to fetch users from HubSpot')
    }

    const users = data.results || []

    return {
      success: true,
      output: {
        users,
        metadata: {
          operation: 'get_users' as const,
          totalItems: users.length,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Users data',
      properties: {
        users: {
          type: 'array',
          description: 'Array of user objects',
        },
        metadata: {
          type: 'object',
          description: 'Operation metadata',
        },
        success: { type: 'boolean', description: 'Operation success status' },
      },
    },
  },
}
