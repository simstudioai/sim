import {
  CLICKUP_API_BASE_URL,
  CLICKUP_TIME_ENTRY_OUTPUT_PROPERTIES,
  clickupAuthorizationHeader,
  extractClickUpErrorMessage,
  mapClickUpTimeEntry,
} from '@/tools/clickup/shared'
import type {
  ClickUpGetTimeEntriesParams,
  ClickUpTimeEntryListResponse,
} from '@/tools/clickup/types'
import type { ToolConfig } from '@/tools/types'

export const clickupGetTimeEntriesTool: ToolConfig<
  ClickUpGetTimeEntriesParams,
  ClickUpTimeEntryListResponse
> = {
  id: 'clickup_get_time_entries',
  name: 'ClickUp Get Time Entries',
  description:
    'List time entries in a ClickUp workspace within a date range (defaults to the last 30 days for the authenticated user)',
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
      description: 'ID of the workspace (team) to list time entries from',
    },
    startDate: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Start of the date range as a Unix timestamp in milliseconds',
    },
    endDate: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'End of the date range as a Unix timestamp in milliseconds',
    },
    assignee: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter by user IDs, comma-separated (requires workspace owner/admin to view others)',
    },
    taskId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only entries for this task (use at most one location filter)',
    },
    listId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only entries in this list (use at most one location filter)',
    },
    folderId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only entries in this folder (use at most one location filter)',
    },
    spaceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only entries in this space (use at most one location filter)',
    },
    includeTaskTags: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include task tags in the response',
    },
    includeLocationNames: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include list, folder, and space names in the response',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(
        `${CLICKUP_API_BASE_URL}/team/${encodeURIComponent(params.workspaceId)}/time_entries`
      )
      if (params.startDate !== undefined) {
        url.searchParams.set('start_date', String(params.startDate))
      }
      if (params.endDate !== undefined) url.searchParams.set('end_date', String(params.endDate))
      if (params.assignee) url.searchParams.set('assignee', params.assignee)
      if (params.taskId) url.searchParams.set('task_id', params.taskId)
      if (params.listId) url.searchParams.set('list_id', params.listId)
      if (params.folderId) url.searchParams.set('folder_id', params.folderId)
      if (params.spaceId) url.searchParams.set('space_id', params.spaceId)
      if (params.includeTaskTags !== undefined) {
        url.searchParams.set('include_task_tags', String(params.includeTaskTags))
      }
      if (params.includeLocationNames !== undefined) {
        url.searchParams.set('include_location_names', String(params.includeLocationNames))
      }
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: clickupAuthorizationHeader(params.accessToken),
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json().catch(() => null)

    if (!response.ok) {
      const error = extractClickUpErrorMessage(response, data, 'Failed to get time entries')
      return { success: false, output: { error }, error }
    }

    const rawEntries = Array.isArray(data?.data) ? data.data : []

    return {
      success: true,
      output: { timeEntries: rawEntries.map((entry: unknown) => mapClickUpTimeEntry(entry)) },
    }
  },

  outputs: {
    timeEntries: {
      type: 'array',
      description: 'Time entries in the date range',
      optional: true,
      items: {
        type: 'object',
        properties: CLICKUP_TIME_ENTRY_OUTPUT_PROPERTIES,
      },
    },
  },
}
