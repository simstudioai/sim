import { createLogger } from '@/lib/logs/console/logger'
import type {
  PipedriveGetAllDealsParams,
  PipedriveGetAllDealsResponse,
} from '@/tools/pipedrive/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('PipedriveGetAllDeals')

export const pipedriveGetAllDealsTool: ToolConfig<
  PipedriveGetAllDealsParams,
  PipedriveGetAllDealsResponse
> = {
  id: 'pipedrive_get_all_deals',
  name: 'Get All Deals from Pipedrive',
  description: 'Retrieve all deals from Pipedrive with optional filters',
  version: '1.0.0',

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the Pipedrive API',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Only fetch deals with a specific status. Values: open, won, lost. If omitted, all not deleted deals are returned',
    },
    person_id: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'If supplied, only deals linked to the specified person are returned',
    },
    org_id: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'If supplied, only deals linked to the specified organization are returned',
    },
    pipeline_id: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'If supplied, only deals in the specified pipeline are returned',
    },
    updated_since: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'If set, only deals updated after this time are returned. Format: 2025-01-01T10:20:00Z',
    },
    limit: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Number of results to return (default: 100, max: 500)',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = 'https://api.pipedrive.com/api/v2/deals'
      const queryParams = new URLSearchParams()

      // Add optional parameters to query string if they exist
      if (params.status) queryParams.append('status', params.status)
      if (params.person_id) queryParams.append('person_id', params.person_id)
      if (params.org_id) queryParams.append('org_id', params.org_id)
      if (params.pipeline_id) queryParams.append('pipeline_id', params.pipeline_id)
      if (params.updated_since) queryParams.append('updated_since', params.updated_since)
      if (params.limit) queryParams.append('limit', params.limit)

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
        Accept: 'application/json',
      }
    },
  },

  transformResponse: async (response: Response, params?: PipedriveGetAllDealsParams) => {
    const data = await response.json()

    if (!data.success) {
      logger.error('Pipedrive API request failed', { data })
      throw new Error(data.error || 'Failed to fetch deals from Pipedrive')
    }

    const deals = data.data || []
    const hasMore = data.additional_data?.pagination?.more_items_in_collection || false

    return {
      success: true,
      output: {
        deals,
        metadata: {
          operation: 'get_all_deals' as const,
          totalItems: deals.length,
          hasMore,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Deals data and metadata',
      properties: {
        deals: {
          type: 'array',
          description: 'Array of deal objects from Pipedrive',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number', description: 'Deal ID' },
              title: { type: 'string', description: 'Deal title' },
              value: { type: 'number', description: 'Deal value' },
              currency: { type: 'string', description: 'Deal currency' },
              status: { type: 'string', description: 'Deal status' },
              stage_id: { type: 'number', description: 'Stage ID' },
              pipeline_id: { type: 'number', description: 'Pipeline ID' },
              owner_id: { type: 'number', description: 'Owner user ID' },
              add_time: { type: 'string', description: 'Deal creation time' },
              update_time: { type: 'string', description: 'Deal last update time' },
            },
          },
        },
        metadata: {
          type: 'object',
          description: 'Operation metadata',
          properties: {
            operation: { type: 'string', description: 'The operation performed' },
            totalItems: { type: 'number', description: 'Total number of deals returned' },
            hasMore: {
              type: 'boolean',
              description: 'Whether there are more items to fetch via pagination',
            },
          },
        },
        success: { type: 'boolean', description: 'Operation success status' },
      },
    },
  },
}
