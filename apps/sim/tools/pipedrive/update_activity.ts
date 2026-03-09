import { createLogger } from '@sim/logger'
import type {
  PipedriveUpdateActivityParams,
  PipedriveUpdateActivityResponse,
} from '@/tools/pipedrive/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('PipedriveUpdateActivity')

export const pipedriveUpdateActivityTool: ToolConfig<
  PipedriveUpdateActivityParams,
  PipedriveUpdateActivityResponse
> = {
  id: 'pipedrive_update_activity',
  name: 'Update Activity in Pipedrive',
  description: 'Update an existing activity (task) in Pipedrive',
  version: '1.0.0',

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the Pipedrive API',
    },
    activity_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the activity to update (e.g., "12345")',
    },
    subject: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New subject/title for the activity (e.g., "Updated meeting with client")',
    },
    due_date: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New due date in YYYY-MM-DD format (e.g., "2025-03-20")',
    },
    due_time: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New due time in HH:MM format (e.g., "15:00")',
    },
    duration: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New duration in HH:MM format (e.g., "00:30" for 30 minutes)',
    },
    done: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Mark as done: 0 for not done, 1 for done',
    },
    note: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New notes for the activity',
    },
  },

  request: {
    url: (params) => `https://api.pipedrive.com/v1/activities/${params.activity_id}`,
    method: 'PUT',
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
      const body: Record<string, any> = {}

      if (params.subject) body.subject = params.subject
      if (params.due_date) body.due_date = params.due_date
      if (params.due_time) body.due_time = params.due_time
      if (params.duration) body.duration = params.duration
      if (params.done !== undefined) body.done = params.done === '1' ? 1 : 0
      if (params.note) body.note = params.note

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      logger.error('Pipedrive API request failed', { data })
      throw new Error(data.error || 'Failed to update activity in Pipedrive')
    }

    return {
      success: true,
      output: {
        activity: data.data ?? null,
        success: true,
      },
    }
  },

  outputs: {
    activity: { type: 'object', description: 'The updated activity object', optional: true },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
