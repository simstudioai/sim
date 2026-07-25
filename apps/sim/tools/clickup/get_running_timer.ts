import { isRecordLike } from '@sim/utils/object'
import {
  CLICKUP_API_BASE_URL,
  CLICKUP_TIME_ENTRY_OUTPUT_PROPERTIES,
  clickupAuthorizationHeader,
  extractClickUpErrorMessage,
  mapClickUpTimeEntry,
} from '@/tools/clickup/shared'
import type { ClickUpGetRunningTimerParams, ClickUpTimeEntryResponse } from '@/tools/clickup/types'
import type { ToolConfig } from '@/tools/types'

export const clickupGetRunningTimerTool: ToolConfig<
  ClickUpGetRunningTimerParams,
  ClickUpTimeEntryResponse
> = {
  id: 'clickup_get_running_timer',
  name: 'ClickUp Get Running Timer',
  description:
    'Get the currently running time entry in a ClickUp workspace (null when no timer is running)',
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
      description: 'ID of the workspace (team) to check',
    },
    assignee: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'User ID to check instead of the authenticated user (owners/admins only)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(
        `${CLICKUP_API_BASE_URL}/team/${encodeURIComponent(params.workspaceId)}/time_entries/current`
      )
      if (params.assignee !== undefined) url.searchParams.set('assignee', String(params.assignee))
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
      const error = extractClickUpErrorMessage(response, data, 'Failed to get running timer')
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
      description:
        'The running time entry (duration is negative while running); null when no timer is running',
      optional: true,
      properties: CLICKUP_TIME_ENTRY_OUTPUT_PROPERTIES,
    },
  },
}
