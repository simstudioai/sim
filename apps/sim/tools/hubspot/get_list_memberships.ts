import { createLogger } from '@sim/logger'
import type {
  HubSpotGetListMembershipsParams,
  HubSpotGetListMembershipsResponse,
} from '@/tools/hubspot/types'
import { METADATA_OUTPUT, PAGING_OUTPUT } from '@/tools/hubspot/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('HubSpotGetListMemberships')

export const hubspotGetListMembershipsTool: ToolConfig<
  HubSpotGetListMembershipsParams,
  HubSpotGetListMembershipsResponse
> = {
  id: 'hubspot_get_list_memberships',
  name: 'Get List Members from HubSpot',
  description: 'Retrieve the record IDs that are members of a HubSpot list, ordered by record ID',
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
    listId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the list to read members from',
    },
    limit: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results per page (max 250, default 100)',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor for next page of results (from previous response)',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = `https://api.hubapi.com/crm/v3/lists/${params.listId.trim()}/memberships`
      const queryParams = new URLSearchParams()
      if (params.limit) queryParams.append('limit', params.limit)
      if (params.after) queryParams.append('after', params.after)
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
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('HubSpot API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to get list members from HubSpot')
    }
    const results = data.results || []
    return {
      success: true,
      output: {
        memberships: results,
        paging: data.paging ?? null,
        metadata: {
          totalReturned: results.length,
          hasMore: !!data.paging?.next,
        },
        success: true,
      },
    }
  },

  outputs: {
    memberships: {
      type: 'array',
      description: 'Records that are members of the list',
      items: {
        type: 'object',
        properties: {
          recordId: { type: 'string', description: 'ID of the member record' },
          membershipTimestamp: {
            type: 'string',
            description: 'When the record was added to the list',
            optional: true,
          },
        },
      },
    },
    paging: PAGING_OUTPUT,
    metadata: METADATA_OUTPUT,
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
