import { createLogger } from '@sim/logger'
import type {
  PipedriveCreateProjectParams,
  PipedriveCreateProjectResponse,
} from '@/tools/pipedrive/types'
import { getPipedriveAuthHeaders } from '@/tools/pipedrive/utils'
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
    authStyle: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description:
        'Auth scheme for the token; set by the credential resolver for API-token service accounts',
    },
    title: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The title of the project (e.g., "Q2 Marketing Campaign")',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description of the project',
    },
    start_date: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Project start date in YYYY-MM-DD format (e.g., "2025-04-01")',
    },
    end_date: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Project end date in YYYY-MM-DD format (e.g., "2025-06-30")',
    },
  },

  request: {
    url: () => 'https://api.pipedrive.com/v1/projects',
    method: 'POST',
    headers: (params) => ({
      ...getPipedriveAuthHeaders(params),
      'Content-Type': 'application/json',
    }),
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
        project: data.data ?? null,
        success: true,
      },
    }
  },

  outputs: {
    project: { type: 'object', description: 'The created project object', optional: true },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
