import { createLogger } from '@sim/logger'
import type { HubSpotGetUsersParams, HubSpotGetUsersResponse } from '@/tools/hubspot/types'
import { GENERIC_CRM_ARRAY_OUTPUT, PAGING_OUTPUT } from '@/tools/hubspot/types'
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
      visibility: 'user-or-llm',
      description: 'Number of results to return (default: 10, max: 100)',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor for next page of results (from previous response)',
    },
    properties: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of HubSpot user property names to return (e.g., "hs_email,hs_given_name,hs_family_name")',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = 'https://api.hubapi.com/crm/v3/objects/users'
      const queryParams = new URLSearchParams()

      if (params.limit) {
        queryParams.append('limit', params.limit)
      }
      if (params.after) {
        queryParams.append('after', params.after)
      }
      if (params.properties) {
        queryParams.append('properties', params.properties)
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

  transformResponse: async (response: Response) => {
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
        paging: data.paging ?? null,
        totalItems: users.length,
        success: true,
      },
    }
  },

  outputs: {
    users: GENERIC_CRM_ARRAY_OUTPUT,
    paging: PAGING_OUTPUT,
    totalItems: { type: 'number', description: 'Total number of users returned' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
