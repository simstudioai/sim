import { createLogger } from '@sim/logger'
import type { HubSpotListDealsParams, HubSpotListDealsResponse } from '@/tools/hubspot/types'
import { DEALS_ARRAY_OUTPUT, METADATA_OUTPUT, PAGING_OUTPUT } from '@/tools/hubspot/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('HubSpotListDeals')

export const hubspotListDealsTool: ToolConfig<HubSpotListDealsParams, HubSpotListDealsResponse> = {
  id: 'hubspot_list_deals',
  name: 'List Deals from HubSpot',
  description: 'Retrieve all deals from HubSpot account with pagination support',
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
    properties: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of HubSpot property names to return (e.g., "dealname,amount,dealstage")',
    },
    associations: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of object types to retrieve associated IDs for (e.g., "contacts,companies")',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = 'https://api.hubapi.com/crm/v3/objects/deals'
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
      if (params.associations) {
        queryParams.append('associations', params.associations)
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
      throw new Error(data.message || 'Failed to list deals from HubSpot')
    }

    return {
      success: true,
      output: {
        deals: data.results || [],
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
    deals: DEALS_ARRAY_OUTPUT,
    paging: PAGING_OUTPUT,
    metadata: METADATA_OUTPUT,
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
