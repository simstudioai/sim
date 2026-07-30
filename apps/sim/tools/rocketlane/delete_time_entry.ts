import {
  ROCKETLANE_API_BASE,
  type RocketlaneDeleteTimeEntryParams,
  type RocketlaneDeleteTimeEntryResponse,
  rocketlaneError,
  rocketlaneHeaders,
} from '@/tools/rocketlane/types'
import type { ToolConfig } from '@/tools/types'

export const rocketlaneDeleteTimeEntryTool: ToolConfig<
  RocketlaneDeleteTimeEntryParams,
  RocketlaneDeleteTimeEntryResponse
> = {
  id: 'rocketlane_delete_time_entry',
  name: 'Rocketlane Delete Time Entry',
  description: 'Permanently delete a Rocketlane time entry by ID',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rocketlane API key',
    },
    timeEntryId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the time entry to delete',
    },
  },

  request: {
    url: (params) =>
      `${ROCKETLANE_API_BASE}/time-entries/${encodeURIComponent(params.timeEntryId)}`,
    method: 'DELETE',
    headers: (params) => rocketlaneHeaders(params.apiKey),
  },

  transformResponse: async (response: Response, params?: RocketlaneDeleteTimeEntryParams) => {
    if (!response.ok) {
      throw new Error(await rocketlaneError(response))
    }
    return {
      success: true,
      output: { deleted: true, timeEntryId: params?.timeEntryId ?? null },
    }
  },

  outputs: {
    deleted: { type: 'boolean', description: 'Whether the time entry was deleted' },
    timeEntryId: {
      type: 'number',
      description: 'ID of the deleted time entry',
      optional: true,
    },
  },
}
