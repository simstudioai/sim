import { isRecordLike } from '@sim/utils/object'
import {
  CLICKUP_API_BASE_URL,
  CLICKUP_TIME_ENTRY_OUTPUT_PROPERTIES,
  clickupAuthorizationHeader,
  extractClickUpErrorMessage,
  mapClickUpTimeEntry,
} from '@/tools/clickup/shared'
import type { ClickUpStopTimerParams, ClickUpTimeEntryResponse } from '@/tools/clickup/types'
import type { ToolConfig } from '@/tools/types'

export const clickupStopTimerTool: ToolConfig<ClickUpStopTimerParams, ClickUpTimeEntryResponse> = {
  id: 'clickup_stop_timer',
  name: 'ClickUp Stop Timer',
  description: "Stop the authenticated user's currently running timer in a ClickUp workspace",
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
      description: 'ID of the workspace (team) the timer is running in',
    },
  },

  request: {
    url: (params) =>
      `${CLICKUP_API_BASE_URL}/team/${encodeURIComponent(params.workspaceId)}/time_entries/stop`,
    method: 'POST',
    headers: (params) => ({
      Authorization: clickupAuthorizationHeader(params.accessToken),
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json().catch(() => null)

    if (!response.ok) {
      const error = extractClickUpErrorMessage(response, data, 'Failed to stop timer')
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
      description: 'The stopped time entry',
      optional: true,
      properties: CLICKUP_TIME_ENTRY_OUTPUT_PROPERTIES,
    },
  },
}
