import { createLogger } from '@sim/logger'
import type {
  PipedriveGetAllDealsParams,
  PipedriveGetAllDealsResponse,
} from '@/tools/pipedrive/types'
import {
  PIPEDRIVE_DEAL_OUTPUT_PROPERTIES,
  PIPEDRIVE_METADATA_OUTPUT_PROPERTIES,
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
      visibility: 'user-or-llm',
      description:
        'Only fetch deals with a specific status. Values: open, won, lost. If omitted, all not deleted deals are returned',
    },
    person_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'If supplied, only deals linked to the specified person are returned (e.g., "456")',
    },
    org_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'If supplied, only deals linked to the specified organization are returned (e.g., "789")',
    },
    pipeline_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'If supplied, only deals in the specified pipeline are returned (e.g., "1")',
    },
    updated_since: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'If set, only deals updated after this time are returned. Format: 2025-01-01T10:20:00Z',
    },
    limit: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to return (e.g., "50", default: 100, max: 500)',
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
          total_items: deals.length,
          has_more: hasMore,
        },
        success: true,
      },
    }
  },

  outputs: {
    deals: {
      type: 'array',
      description: 'Array of deal objects from Pipedrive',
      items: {
        type: 'object',
        properties: PIPEDRIVE_DEAL_OUTPUT_PROPERTIES,
      },
    },
    metadata: {
      type: 'object',
      description: 'Pagination metadata for the response',
      properties: PIPEDRIVE_METADATA_OUTPUT_PROPERTIES,
    },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
