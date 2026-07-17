import {
  mapTimeEntry,
  ROCKETLANE_API_BASE,
  type RocketlaneGetTimeEntryParams,
  type RocketlaneTimeEntryResponse,
  rocketlaneError,
  rocketlaneHeaders,
  TIME_ENTRY_OUTPUT_PROPERTIES,
} from '@/tools/rocketlane/types'
import type { ToolConfig } from '@/tools/types'

export const rocketlaneGetTimeEntryTool: ToolConfig<
  RocketlaneGetTimeEntryParams,
  RocketlaneTimeEntryResponse
> = {
  id: 'rocketlane_get_time_entry',
  name: 'Rocketlane Get Time Entry',
  description: 'Get a single Rocketlane time entry by ID',
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
      description: 'ID of the time entry to retrieve',
    },
    includeFields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated extra fields to include in the response (notes, sourceType, deleted, status, submittedBy, submittedAt, approvedBy, approvedAt, rejectedBy, rejectedAt, costRate, billRate)',
    },
    includeAllFields: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether all fields should be returned in the response',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(
        `${ROCKETLANE_API_BASE}/time-entries/${encodeURIComponent(params.timeEntryId)}`
      )
      if (params.includeFields) url.searchParams.set('includeFields', params.includeFields)
      if (params.includeAllFields != null) {
        url.searchParams.set('includeAllFields', String(params.includeAllFields))
      }
      return url.toString()
    },
    method: 'GET',
    headers: (params) => rocketlaneHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      throw new Error(await rocketlaneError(response))
    }
    const data = await response.json()
    return {
      success: true,
      output: { timeEntry: mapTimeEntry(data) },
    }
  },

  outputs: {
    timeEntry: {
      type: 'object',
      description: 'The requested time entry',
      properties: TIME_ENTRY_OUTPUT_PROPERTIES,
    },
  },
}
