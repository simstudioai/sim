import { createLogger } from '@/lib/logs/console/logger'
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
      visibility: 'user-only',
      description: 'The ID of the pipeline',
    },
    stage_id: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Filter by specific stage within the pipeline',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Filter by deal status: open, won, lost',
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
          operation: 'get_pipeline_deals' as const,
          pipelineId: params?.pipeline_id || '',
          totalItems: deals.length,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Pipeline deals data',
      properties: {
        deals: {
          type: 'array',
          description: 'Array of deal objects from the pipeline',
        },
        metadata: {
          type: 'object',
          description: 'Operation metadata including pipeline ID',
        },
        success: { type: 'boolean', description: 'Operation success status' },
      },
    },
  },
}
