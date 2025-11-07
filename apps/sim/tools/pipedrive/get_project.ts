import { createLogger } from '@/lib/logs/console/logger'
import type {
  PipedriveGetProjectParams,
  PipedriveGetProjectResponse,
} from '@/tools/pipedrive/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('PipedriveGetProject')

export const pipedriveGetProjectTool: ToolConfig<
  PipedriveGetProjectParams,
  PipedriveGetProjectResponse
> = {
  id: 'pipedrive_get_project',
  name: 'Get Project Details from Pipedrive',
  description: 'Retrieve detailed information about a specific project',
  version: '1.0.0',

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the Pipedrive API',
    },
    project_id: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The ID of the project to retrieve',
    },
  },

  request: {
    url: (params) => `https://api.pipedrive.com/v1/projects/${params.project_id}`,
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
      throw new Error(data.error || 'Failed to fetch project from Pipedrive')
    }

    return {
      success: true,
      output: {
        project: data.data,
        metadata: {
          operation: 'get_project' as const,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Project details',
      properties: {
        project: {
          type: 'object',
          description: 'Project object with full details',
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
