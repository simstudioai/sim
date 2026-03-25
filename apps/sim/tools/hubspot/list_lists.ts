import { createLogger } from '@sim/logger'
import type { HubSpotListListsParams, HubSpotListListsResponse } from '@/tools/hubspot/types'
import { LISTS_ARRAY_OUTPUT, METADATA_OUTPUT, PAGING_OUTPUT } from '@/tools/hubspot/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('HubSpotListLists')

export const hubspotListListsTool: ToolConfig<HubSpotListListsParams, HubSpotListListsResponse> = {
  id: 'hubspot_list_lists',
  name: 'List Lists from HubSpot',
  description: 'Search and retrieve lists from HubSpot account',
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
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search query to filter lists by name',
    },
    count: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results to return (default 25)',
    },
  },

  request: {
    url: () => 'https://api.hubapi.com/crm/v3/lists/search',
    method: 'POST',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }
      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.query) body.query = params.query
      if (params.count) body.count = Number(params.count)
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('HubSpot API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to list lists from HubSpot')
    }
    const lists = data.lists ?? data.results ?? []
    return {
      success: true,
      output: {
        lists,
        paging: data.paging ?? null,
        metadata: {
          totalReturned: lists.length,
          hasMore: !!data.paging?.next || data.hasMore === true,
        },
        success: true,
      },
    }
  },

  outputs: {
    lists: LISTS_ARRAY_OUTPUT,
    paging: PAGING_OUTPUT,
    metadata: METADATA_OUTPUT,
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
