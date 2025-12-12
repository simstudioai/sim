import { createLogger } from '@/lib/logs/console/logger'
import type {
  PipedriveCreateProjectParams,
  PipedriveCreateProjectResponse,
} from '@/tools/pipedrive/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('PipedriveCreateProject')

export const pipedriveCreateProjectTool: ToolConfig<
  PipedriveCreateProjectParams,
  PipedriveCreateProjectResponse
> = {
  id: 'pipedrive_create_project',
  name: 'Create Project in Pipedrive',
  description: 'Create a new project in Pipedrive',
  version: '1.0.0',

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the Pipedrive API',
    },
    title: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The title of the project',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Description of the project',
    },
    start_date: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Project start date in YYYY-MM-DD format',
    },
    end_date: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Project end date in YYYY-MM-DD format',
    },
  },

  request: {
    url: () => 'https://api.pipedrive.com/v1/projects',
    method: 'POST',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      }
    },
    body: (params) => {
      const body: Record<string, any> = {
        title: params.title,
      }

      if (params.description) body.description = params.description
      if (params.start_date) body.start_date = params.start_date
      if (params.end_date) body.end_date = params.end_date

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      logger.error('Pipedrive API request failed', { data })
      throw new Error(data.error || 'Failed to create project in Pipedrive')
    }

    return {
      success: true,
      output: {
        project: data.data,
        metadata: {
          operation: 'create_project' as const,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Created project details',
      properties: {
        project: {
          type: 'object',
          description: 'The created project object',
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
