import { isRecordLike } from '@sim/utils/object'
import {
  CLICKUP_API_BASE_URL,
  CLICKUP_TIME_ENTRY_OUTPUT_PROPERTIES,
  clickupAuthorizationHeader,
  extractClickUpErrorMessage,
  mapClickUpTimeEntry,
} from '@/tools/clickup/shared'
import type { ClickUpDeleteTimeEntryParams, ClickUpTimeEntryResponse } from '@/tools/clickup/types'
import type { ToolConfig } from '@/tools/types'

export const clickupDeleteTimeEntryTool: ToolConfig<
  ClickUpDeleteTimeEntryParams,
  ClickUpTimeEntryResponse
> = {
  id: 'clickup_delete_time_entry',
  name: 'ClickUp Delete Time Entry',
  description: 'Delete a time entry from a ClickUp workspace',
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
      description: 'ID of the time entry to delete',
    },
  },

  request: {
    url: (params) =>
      `${CLICKUP_API_BASE_URL}/team/${encodeURIComponent(params.workspaceId)}/time_entries/${encodeURIComponent(params.timerId)}`,
    method: 'DELETE',
    headers: (params) => ({
      Authorization: clickupAuthorizationHeader(params.accessToken),
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json().catch(() => null)

    if (!response.ok) {
      const error = extractClickUpErrorMessage(response, data, 'Failed to delete time entry')
      return { success: false, output: { error }, error }
    }

    const entry = isRecordLike(data) && isRecordLike(data.data) ? data.data : null

    return {
      success: true,
      output: { timeEntry: entry ? mapClickUpTimeEntry(entry) : null },
    }
  },

  outputs: {
    timeEntry: {
      type: 'json',
      description: 'The deleted time entry',
      optional: true,
      properties: CLICKUP_TIME_ENTRY_OUTPUT_PROPERTIES,
    },
  },
}
