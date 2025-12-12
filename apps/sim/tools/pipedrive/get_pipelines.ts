import { createLogger } from '@/lib/logs/console/logger'
import type {
  PipedriveGetPipelinesParams,
  PipedriveGetPipelinesResponse,
} from '@/tools/pipedrive/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('PipedriveGetPipelines')

export const pipedriveGetPipelinesTool: ToolConfig<
  PipedriveGetPipelinesParams,
  PipedriveGetPipelinesResponse
> = {
  id: 'pipedrive_get_pipelines',
  name: 'Get Pipelines from Pipedrive',
  description: 'Retrieve all pipelines from Pipedrive',
  version: '1.0.0',

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the Pipedrive API',
    },
    sort_by: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Field to sort by: id, update_time, add_time (default: id)',
    },
    sort_direction: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Sorting direction: asc, desc (default: asc)',
    },
    limit: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Number of results to return (default: 100, max: 500)',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'For pagination, the marker representing the first item on the next page',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = 'https://api.pipedrive.com/v1/pipelines'
      const queryParams = new URLSearchParams()

      if (params.sort_by) queryParams.append('sort_by', params.sort_by)
      if (params.sort_direction) queryParams.append('sort_direction', params.sort_direction)
      if (params.limit) queryParams.append('limit', params.limit)
      if (params.cursor) queryParams.append('cursor', params.cursor)

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

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      logger.error('Pipedrive API request failed', { data })
      throw new Error(data.error || 'Failed to fetch pipelines from Pipedrive')
    }

    const pipelines = data.data || []

    return {
      success: true,
      output: {
        pipelines,
        metadata: {
          operation: 'get_pipelines' as const,
          totalItems: pipelines.length,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Pipelines data',
      properties: {
        pipelines: {
          type: 'array',
          description: 'Array of pipeline objects from Pipedrive',
        },
        metadata: {
          type: 'object',
          description: 'Operation metadata',
        },
        success: { type: 'boolean', description: 'Operation success status' },
      },
    },
  },
}
