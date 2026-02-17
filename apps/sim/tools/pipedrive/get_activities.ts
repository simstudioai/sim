import { createLogger } from '@sim/logger'
import type {
  PipedriveGetActivitiesParams,
  PipedriveGetActivitiesResponse,
} from '@/tools/pipedrive/types'
import { PIPEDRIVE_ACTIVITY_OUTPUT_PROPERTIES } from '@/tools/pipedrive/types'
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
    user_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter activities by user ID (e.g., "123")',
    },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by activity type (call, meeting, task, deadline, email, lunch)',
    },
    done: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by completion status: 0 for not done, 1 for done',
    },
    limit: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to return (e.g., "50", default: 100, max: 500)',
    },
    start: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination start offset (0-based index of the first item to return)',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = 'https://api.pipedrive.com/v1/activities'
      const queryParams = new URLSearchParams()

      if (params.user_id) queryParams.append('user_id', params.user_id)
      if (params.type) queryParams.append('type', params.type)
      if (params.done) queryParams.append('done', params.done)
      if (params.limit) queryParams.append('limit', params.limit)
      if (params.start) queryParams.append('start', params.start)

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
    const hasMore = data.additional_data?.pagination?.more_items_in_collection || false
    const nextStart = data.additional_data?.pagination?.next_start ?? null

    return {
      success: true,
      output: {
        activities,
        total_items: activities.length,
        has_more: hasMore,
        next_start: nextStart,
        success: true,
      },
    }
  },

  outputs: {
    activities: {
      type: 'array',
      description: 'Array of activity objects from Pipedrive',
      items: {
        type: 'object',
        properties: PIPEDRIVE_ACTIVITY_OUTPUT_PROPERTIES,
      },
    },
    total_items: { type: 'number', description: 'Total number of activities returned' },
    has_more: {
      type: 'boolean',
      description: 'Whether more activities are available',
      optional: true,
    },
    next_start: {
      type: 'number',
      description: 'Offset for fetching the next page',
      optional: true,
    },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
