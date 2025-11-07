import { createLogger } from '@/lib/logs/console/logger'
import type {
  PipedriveGetProjectsParams,
  PipedriveGetProjectsResponse,
} from '@/tools/pipedrive/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('PipedriveGetProjects')

export const pipedriveGetProjectsTool: ToolConfig<
  PipedriveGetProjectsParams,
  PipedriveGetProjectsResponse
> = {
  id: 'pipedrive_get_projects',
  name: 'Get Projects from Pipedrive',
  description: 'Retrieve all projects from Pipedrive',
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
      description: 'Filter by project status: open, completed, deleted',
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
      const baseUrl = 'https://api.pipedrive.com/v1/projects'
      const queryParams = new URLSearchParams()

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

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      logger.error('Pipedrive API request failed', { data })
      throw new Error(data.error || 'Failed to fetch projects from Pipedrive')
    }

    const projects = data.data || []

    return {
      success: true,
      output: {
        projects,
        metadata: {
          operation: 'get_projects' as const,
          totalItems: projects.length,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Projects data',
      properties: {
        projects: {
          type: 'array',
          description: 'Array of project objects from Pipedrive',
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
