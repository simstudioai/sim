import { createLogger } from '@/lib/logs/console/logger'
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
      visibility: 'user-only',
      description: 'The subject/title of the activity',
    },
    type: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Activity type: call, meeting, task, deadline, email, lunch',
    },
    due_date: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Due date in YYYY-MM-DD format',
    },
    due_time: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Due time in HH:MM format',
    },
    duration: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Duration in HH:MM format',
    },
    deal_id: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'ID of the deal to associate with',
    },
    person_id: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'ID of the person to associate with',
    },
    org_id: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'ID of the organization to associate with',
    },
    note: {
      type: 'string',
      required: false,
      visibility: 'user-only',
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
        activity: data.data,
        metadata: {
          operation: 'create_activity' as const,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Created activity details',
      properties: {
        activity: {
          type: 'object',
          description: 'The created activity object',
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
