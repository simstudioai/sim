import { createLogger } from '@sim/logger'
import type { HubSpotListOwnersParams, HubSpotListOwnersResponse } from '@/tools/hubspot/types'
import { METADATA_OUTPUT, OWNERS_ARRAY_OUTPUT, PAGING_OUTPUT } from '@/tools/hubspot/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('HubSpotListOwners')

export const hubspotListOwnersTool: ToolConfig<HubSpotListOwnersParams, HubSpotListOwnersResponse> =
  {
    id: 'hubspot_list_owners',
    name: 'List Owners from HubSpot',
    description: 'Retrieve all owners from HubSpot account with pagination support',
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
        description: 'Maximum number of results per page (max 100, default 100)',
      },
      after: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Pagination cursor for next page of results (from previous response)',
      },
      email: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter owners by email address',
      },
    },

    request: {
      url: (params) => {
        const baseUrl = 'https://api.hubapi.com/crm/v3/owners'
        const queryParams = new URLSearchParams()
        if (params.limit) queryParams.append('limit', params.limit)
        if (params.after) queryParams.append('after', params.after)
        if (params.email) queryParams.append('email', params.email)
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
        throw new Error(data.message || 'Failed to list owners from HubSpot')
      }
      return {
        success: true,
        output: {
          owners: data.results || [],
          paging: data.paging ?? null,
          metadata: {
            totalReturned: data.results?.length || 0,
            hasMore: !!data.paging?.next,
          },
          success: true,
        },
      }
    },

    outputs: {
      owners: OWNERS_ARRAY_OUTPUT,
      paging: PAGING_OUTPUT,
      metadata: METADATA_OUTPUT,
      success: { type: 'boolean', description: 'Operation success status' },
    },
  }
