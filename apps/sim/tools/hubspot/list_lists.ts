import { createLogger } from '@sim/logger'
import type { HubSpotListListsParams, HubSpotListListsResponse } from '@/tools/hubspot/types'
import {
  LISTS_ARRAY_OUTPUT,
  METADATA_OUTPUT_PROPERTIES,
  PAGING_OUTPUT,
} from '@/tools/hubspot/types'
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
      description: 'Search query to filter lists by name. Leave empty to return all lists.',
    },
    count: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results to return (default 20, max 500)',
    },
    offset: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Pagination offset for next page of results (use the offset value from previous response)',
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
      const body: Record<string, unknown> = {
        offset: params.offset ? Number(params.offset) : 0,
      }
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
    const lists = data.lists ?? []
    return {
      success: true,
      output: {
        lists,
        paging:
          data.hasMore === true && data.offset != null
            ? { next: { after: String(data.offset) } }
            : undefined,
        metadata: {
          totalReturned: lists.length,
          total: data.total ?? null,
          hasMore: data.hasMore === true,
        },
        success: true,
      },
    }
  },

  outputs: {
    lists: LISTS_ARRAY_OUTPUT,
    paging: PAGING_OUTPUT,
    metadata: {
      type: 'object',
      description: 'Response metadata',
      properties: {
        ...METADATA_OUTPUT_PROPERTIES,
        total: {
          type: 'number',
          description: 'Total number of lists matching the query',
          optional: true,
        },
      },
    },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
