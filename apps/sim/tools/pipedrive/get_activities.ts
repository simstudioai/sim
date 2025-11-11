import { createLogger } from '@/lib/logs/console/logger'
import type {
  PipedriveGetActivitiesParams,
  PipedriveGetActivitiesResponse,
} from '@/tools/pipedrive/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('PipedriveGetActivities')

export const pipedriveGetActivitiesTool: ToolConfig<
  PipedriveGetActivitiesParams,
  PipedriveGetActivitiesResponse
> = {
  id: 'pipedrive_get_activities',
  name: 'Get Activities from Pipedrive',
  description: 'Retrieve activities (tasks) from Pipedrive with optional filters',
  version: '1.0.0',

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the Pipedrive API',
    },
    deal_id: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Filter activities by deal ID',
    },
    person_id: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Filter activities by person ID',
    },
    org_id: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Filter activities by organization ID',
    },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Filter by activity type (call, meeting, task, deadline, email, lunch)',
    },
    done: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Filter by completion status: 0 for not done, 1 for done',
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
      const baseUrl = 'https://api.pipedrive.com/v1/activities'
      const queryParams = new URLSearchParams()

      if (params.deal_id) queryParams.append('deal_id', params.deal_id)
      if (params.person_id) queryParams.append('person_id', params.person_id)
      if (params.org_id) queryParams.append('org_id', params.org_id)
      if (params.type) queryParams.append('type', params.type)
      if (params.done) queryParams.append('done', params.done)
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
      throw new Error(data.error || 'Failed to fetch activities from Pipedrive')
    }

    const activities = data.data || []

    return {
      success: true,
      output: {
        activities,
        metadata: {
          operation: 'get_activities' as const,
          totalItems: activities.length,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Activities data',
      properties: {
        activities: {
          type: 'array',
          description: 'Array of activity objects from Pipedrive',
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
