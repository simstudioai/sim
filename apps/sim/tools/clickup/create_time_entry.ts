import { isRecordLike } from '@sim/utils/object'
import {
  CLICKUP_API_BASE_URL,
  CLICKUP_TIME_ENTRY_OUTPUT_PROPERTIES,
  clickupAuthorizationHeader,
  extractClickUpErrorMessage,
  mapClickUpTimeEntry,
} from '@/tools/clickup/shared'
import type { ClickUpCreateTimeEntryParams, ClickUpTimeEntryResponse } from '@/tools/clickup/types'
import type { ToolConfig } from '@/tools/types'

export const clickupCreateTimeEntryTool: ToolConfig<
  ClickUpCreateTimeEntryParams,
  ClickUpTimeEntryResponse
> = {
  id: 'clickup_create_time_entry',
  name: 'ClickUp Create Time Entry',
  description: 'Create a manual time entry in a ClickUp workspace, optionally linked to a task',
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
      description: 'ID of the workspace (team) to create the entry in',
    },
    start: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Start of the entry as a Unix timestamp in milliseconds',
    },
    duration: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Duration of the entry in milliseconds',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description of the time entry',
    },
    billable: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the entry is billable',
    },
    taskId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Task ID to associate the entry with',
    },
    assignee: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'User ID to create the entry for (workspace owners/admins only)',
    },
  },

  request: {
    url: (params) =>
      `${CLICKUP_API_BASE_URL}/team/${encodeURIComponent(params.workspaceId)}/time_entries`,
    method: 'POST',
    headers: (params) => ({
      Authorization: clickupAuthorizationHeader(params.accessToken),
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        start: params.start,
        duration: params.duration,
      }

      if (params.description) body.description = params.description
      if (params.billable !== undefined) body.billable = params.billable
      if (params.taskId) body.tid = params.taskId
      if (params.assignee !== undefined) body.assignee = params.assignee

      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json().catch(() => null)

    if (!response.ok) {
      const error = extractClickUpErrorMessage(response, data, 'Failed to create time entry')
      return { success: false, output: { error }, error }
    }

    const entry =
      isRecordLike(data) && isRecordLike(data.data)
        ? data.data
        : isRecordLike(data) && data.id !== undefined
          ? data
          : null

    return {
      success: true,
      output: { timeEntry: entry ? mapClickUpTimeEntry(entry) : null },
    }
  },

  outputs: {
    timeEntry: {
      type: 'json',
      description: 'The created time entry',
      optional: true,
      properties: CLICKUP_TIME_ENTRY_OUTPUT_PROPERTIES,
    },
  },
}
