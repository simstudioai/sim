import {
  mapTimeEntry,
  ROCKETLANE_API_BASE,
  type RocketlaneTimeEntryResponse,
  type RocketlaneUpdateTimeEntryParams,
  rocketlaneError,
  rocketlaneHeaders,
  TIME_ENTRY_OUTPUT_PROPERTIES,
} from '@/tools/rocketlane/types'
import type { ToolConfig } from '@/tools/types'

export const rocketlaneUpdateTimeEntryTool: ToolConfig<
  RocketlaneUpdateTimeEntryParams,
  RocketlaneTimeEntryResponse
> = {
  id: 'rocketlane_update_time_entry',
  name: 'Rocketlane Update Time Entry',
  description:
    'Update a Rocketlane time entry by ID. The activityName, notes, billable, and minutes properties can be updated',
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
      description: 'ID of the time entry to update',
    },
    date: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Date of the time entry in YYYY-MM-DD format (mandatory so the total time for the date does not exceed 24 hours)',
    },
    minutes: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Duration of the time entry in minutes (1-1440)',
    },
    activityName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New name for the adhoc activity',
    },
    notes: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New notes for the time entry',
    },
    billable: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the time entry is billable',
    },
    categoryId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the time entry category',
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
    method: 'PUT',
    headers: (params) => rocketlaneHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = {
        date: params.date,
        minutes: params.minutes,
      }
      if (params.activityName !== undefined) body.activityName = params.activityName
      if (params.notes !== undefined) body.notes = params.notes
      if (params.billable != null) body.billable = params.billable
      if (params.categoryId != null) body.category = { categoryId: params.categoryId }
      return body
    },
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
      description: 'The updated time entry',
      properties: TIME_ENTRY_OUTPUT_PROPERTIES,
    },
  },
}
