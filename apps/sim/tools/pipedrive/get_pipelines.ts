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
  },

  request: {
    url: () => 'https://api.pipedrive.com/v1/pipelines',
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
