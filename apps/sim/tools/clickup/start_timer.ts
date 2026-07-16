import { isRecordLike } from '@sim/utils/object'
import {
  CLICKUP_API_BASE_URL,
  CLICKUP_TIME_ENTRY_OUTPUT_PROPERTIES,
  clickupAuthorizationHeader,
  extractClickUpErrorMessage,
  mapClickUpTimeEntry,
} from '@/tools/clickup/shared'
import type { ClickUpStartTimerParams, ClickUpTimeEntryResponse } from '@/tools/clickup/types'
import type { ToolConfig } from '@/tools/types'

export const clickupStartTimerTool: ToolConfig<ClickUpStartTimerParams, ClickUpTimeEntryResponse> =
  {
    id: 'clickup_start_timer',
    name: 'ClickUp Start Timer',
    description: 'Start a timer for the authenticated user in a ClickUp workspace',
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
        description: 'ID of the workspace (team) to start the timer in',
      },
      taskId: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Task ID to associate the timer with',
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
      tags: {
        type: 'array',
        required: false,
        visibility: 'user-or-llm',
        description: 'Time entry tag names to apply',
        items: {
          type: 'string',
          description: 'A time entry tag name',
        },
      },
    },

    request: {
      url: (params) =>
        `${CLICKUP_API_BASE_URL}/team/${encodeURIComponent(params.workspaceId)}/time_entries/start`,
      method: 'POST',
      headers: (params) => ({
        Authorization: clickupAuthorizationHeader(params.accessToken),
        'Content-Type': 'application/json',
      }),
      body: (params) => {
        const body: Record<string, unknown> = {}

        if (params.taskId) body.tid = params.taskId
        if (params.description) body.description = params.description
        if (params.billable !== undefined) body.billable = params.billable
        if (params.tags?.length) body.tags = params.tags.map((name) => ({ name }))

        return body
      },
    },

    transformResponse: async (response) => {
      const data = await response.json().catch(() => null)

      if (!response.ok) {
        const error = extractClickUpErrorMessage(response, data, 'Failed to start timer')
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
        description: 'The started time entry (duration is negative while running)',
        optional: true,
        properties: CLICKUP_TIME_ENTRY_OUTPUT_PROPERTIES,
      },
    },
  }
