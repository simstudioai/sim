import { createLogger } from '@sim/logger'
import type {
  HubSpotListAssociationsParams,
  HubSpotListAssociationsResponse,
} from '@/tools/hubspot/types'
import { ASSOCIATIONS_ARRAY_OUTPUT, METADATA_OUTPUT, PAGING_OUTPUT } from '@/tools/hubspot/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('HubSpotListAssociations')

export const hubspotListAssociationsTool: ToolConfig<
  HubSpotListAssociationsParams,
  HubSpotListAssociationsResponse
> = {
  id: 'hubspot_list_associations',
  name: 'List Associations in HubSpot',
  description:
    'List records of one object type associated with a given record, e.g. all emails or notes logged on a contact',
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
    objectType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Source object type (e.g., "contacts", "companies", "deals")',
    },
    objectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the source record',
    },
    toObjectType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Target object type to list associations to (e.g., "emails", "notes", "deals")',
    },
    limit: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of associated records per page (default 500)',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor for next page (from previous response)',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = `https://api.hubapi.com/crm/v4/objects/${encodeURIComponent(params.objectType.trim())}/${encodeURIComponent(params.objectId.trim())}/associations/${encodeURIComponent(params.toObjectType.trim())}`
      const queryParams = new URLSearchParams()

      if (params.limit) {
        queryParams.append('limit', params.limit)
      }
      if (params.after) {
        queryParams.append('after', params.after)
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
      throw new Error(data.message || 'Failed to list associations from HubSpot')
    }

    return {
      success: true,
      output: {
        results: data.results || [],
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
    results: ASSOCIATIONS_ARRAY_OUTPUT,
    paging: PAGING_OUTPUT,
    metadata: METADATA_OUTPUT,
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
