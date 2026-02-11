import { createLogger } from '@sim/logger'
import type {
  PipedriveGetPipelineDealsParams,
  PipedriveGetPipelineDealsResponse,
} from '@/tools/pipedrive/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('PipedriveGetPipelineDeals')

export const pipedriveGetPipelineDealsTool: ToolConfig<
  PipedriveGetPipelineDealsParams,
  PipedriveGetPipelineDealsResponse
> = {
  id: 'pipedrive_get_pipeline_deals',
  name: 'Get Pipeline Deals from Pipedrive',
  description: 'Retrieve all deals in a specific pipeline',
  version: '1.0.0',

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the Pipedrive API',
    },
    pipeline_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the pipeline (e.g., "1")',
    },
    stage_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by specific stage within the pipeline (e.g., "2")',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by deal status: open, won, lost',
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
      const baseUrl = `https://api.pipedrive.com/v1/pipelines/${params.pipeline_id}/deals`
      const queryParams = new URLSearchParams()

      if (params.stage_id) queryParams.append('stage_id', params.stage_id)
      if (params.status) queryParams.append('status', params.status)
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

  transformResponse: async (response: Response, params) => {
    const data = await response.json()

    if (!data.success) {
      logger.error('Pipedrive API request failed', { data })
      throw new Error(data.error || 'Failed to fetch pipeline deals from Pipedrive')
    }

    const deals = data.data || []

    return {
      success: true,
      output: {
        deals,
        metadata: {
          pipeline_id: params?.pipeline_id || '',
          total_items: deals.length,
        },
        success: true,
      },
    }
  },

  outputs: {
    deals: { type: 'array', description: 'Array of deal objects from the pipeline' },
    metadata: {
      type: 'object',
      description: 'Pipeline and pagination metadata',
    },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
