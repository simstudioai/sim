import {
  CLICKUP_API_BASE_URL,
  clickupAuthorizationHeader,
  extractClickUpErrorMessage,
} from '@/tools/clickup/shared'
import type {
  ClickUpUpdateTimeEntryParams,
  ClickUpUpdateTimeEntryResponse,
} from '@/tools/clickup/types'
import type { ToolConfig } from '@/tools/types'

export const clickupUpdateTimeEntryTool: ToolConfig<
  ClickUpUpdateTimeEntryParams,
  ClickUpUpdateTimeEntryResponse
> = {
  id: 'clickup_update_time_entry',
  name: 'ClickUp Update Time Entry',
  description:
    'Update a time entry in a ClickUp workspace — description, start/end times, task, or billable state',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'clickup',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token or personal API token for ClickUp',
    },
    workspaceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the workspace (team) the entry belongs to',
    },
    timerId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the time entry to update',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New description for the entry',
    },
    start: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'New start (Unix ms); when provided, end must also be provided',
    },
    end: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'New end (Unix ms); when provided, start must also be provided',
    },
    taskId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Task ID to associate the entry with',
    },
    billable: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the entry is billable',
    },
  },

  request: {
    url: (params) =>
      `${CLICKUP_API_BASE_URL}/team/${encodeURIComponent(params.workspaceId)}/time_entries/${encodeURIComponent(params.timerId)}`,
    method: 'PUT',
    headers: (params) => ({
      Authorization: clickupAuthorizationHeader(params.accessToken),
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}

      if (params.description !== undefined) body.description = params.description
      if (params.start !== undefined) body.start = params.start
      if (params.end !== undefined) body.end = params.end
      if (params.taskId) body.tid = params.taskId
      if (params.billable !== undefined) body.billable = params.billable

      if (Object.keys(body).length === 0) {
        throw new Error(
          'At least one of description, start and end, taskId, or billable is required to update a time entry'
        )
      }

      if ((params.start === undefined) !== (params.end === undefined)) {
        throw new Error('start and end must be provided together when updating entry times')
      }

      return body
    },
  },

  transformResponse: async (response, params) => {
    if (!response.ok) {
      const data = await response.json().catch(() => null)
      const error = extractClickUpErrorMessage(response, data, 'Failed to update time entry')
      return { success: false, output: { error }, error }
    }

    return {
      success: true,
      output: { id: params?.timerId, updated: true },
    }
  },

  outputs: {
    id: { type: 'string', description: 'ID of the updated time entry', optional: true },
    updated: { type: 'boolean', description: 'Whether the entry was updated', optional: true },
  },
}
