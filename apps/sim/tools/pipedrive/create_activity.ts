import { createLogger } from '@sim/logger'
import type {
  PipedriveCreateActivityParams,
  PipedriveCreateActivityResponse,
} from '@/tools/pipedrive/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('PipedriveCreateActivity')

export const pipedriveCreateActivityTool: ToolConfig<
  PipedriveCreateActivityParams,
  PipedriveCreateActivityResponse
> = {
  id: 'pipedrive_create_activity',
  name: 'Create Activity in Pipedrive',
  description: 'Create a new activity (task) in Pipedrive',
  version: '1.0.0',

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the Pipedrive API',
    },
    subject: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The subject/title of the activity (e.g., "Follow up call with John")',
    },
    type: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Activity type: call, meeting, task, deadline, email, lunch',
    },
    due_date: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Due date in YYYY-MM-DD format (e.g., "2025-03-15")',
    },
    due_time: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Due time in HH:MM format (e.g., "14:30")',
    },
    duration: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Duration in HH:MM format (e.g., "01:00" for 1 hour)',
    },
    deal_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the deal to associate with (e.g., "123")',
    },
    person_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the person to associate with (e.g., "456")',
    },
    org_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the organization to associate with (e.g., "789")',
    },
    note: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Notes for the activity',
    },
  },

  request: {
    url: () => 'https://api.pipedrive.com/v1/activities',
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
        subject: params.subject,
        type: params.type,
        due_date: params.due_date,
      }

      if (params.due_time) body.due_time = params.due_time
      if (params.duration) body.duration = params.duration
      if (params.deal_id) body.deal_id = Number(params.deal_id)
      if (params.person_id) body.person_id = Number(params.person_id)
      if (params.org_id) body.org_id = Number(params.org_id)
      if (params.note) body.note = params.note

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      logger.error('Pipedrive API request failed', { data })
      throw new Error(data.error || 'Failed to create activity in Pipedrive')
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
    activity: { type: 'object', description: 'The created activity object', optional: true },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
