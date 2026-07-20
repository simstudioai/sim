import {
  mapTimeEntry,
  ROCKETLANE_API_BASE,
  type RocketlaneCreateTimeEntryParams,
  type RocketlaneTimeEntryResponse,
  rocketlaneError,
  rocketlaneHeaders,
  TIME_ENTRY_OUTPUT_PROPERTIES,
} from '@/tools/rocketlane/types'
import type { ToolConfig } from '@/tools/types'

export const rocketlaneCreateTimeEntryTool: ToolConfig<
  RocketlaneCreateTimeEntryParams,
  RocketlaneTimeEntryResponse
> = {
  id: 'rocketlane_create_time_entry',
  name: 'Rocketlane Create Time Entry',
  description:
    'Create a time entry in Rocketlane against an adhoc activity, task, project phase, or project',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rocketlane API key',
    },
    date: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Date of the time entry in YYYY-MM-DD format',
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
      description:
        'Name of the adhoc activity to track time against. Exactly one source is required among activityName, taskId, projectPhaseId, and projectId — providing more than one results in an error',
    },
    taskId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'ID of the task to track time against. Exactly one source is required among activityName, taskId, projectPhaseId, and projectId — providing more than one results in an error',
    },
    projectPhaseId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'ID of the project phase to track time against. Exactly one source is required among activityName, taskId, projectPhaseId, and projectId — providing more than one results in an error',
    },
    projectId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'ID of the project to track time against. Exactly one source is required among activityName, taskId, projectPhaseId, and projectId — providing more than one results in an error',
    },
    billable: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the time entry is billable (defaults to true)',
    },
    userId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the user the time entry belongs to',
    },
    userEmail: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email of the user the time entry belongs to (alternative to userId)',
    },
    notes: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Notes for the time entry',
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
      const url = new URL(`${ROCKETLANE_API_BASE}/time-entries`)
      if (params.includeFields) url.searchParams.set('includeFields', params.includeFields)
      if (params.includeAllFields != null) {
        url.searchParams.set('includeAllFields', String(params.includeAllFields))
      }
      return url.toString()
    },
    method: 'POST',
    headers: (params) => rocketlaneHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = {
        date: params.date,
        minutes: params.minutes,
      }
      if (params.activityName) body.activityName = params.activityName
      if (params.taskId != null) body.task = { taskId: params.taskId }
      if (params.projectPhaseId != null) body.projectPhase = { phaseId: params.projectPhaseId }
      if (params.projectId != null) body.project = { projectId: params.projectId }
      if (params.billable != null) body.billable = params.billable
      if (params.userId != null || params.userEmail) {
        const user: Record<string, unknown> = {}
        if (params.userId != null) user.userId = params.userId
        if (params.userEmail) user.emailId = params.userEmail
        body.user = user
      }
      if (params.notes) body.notes = params.notes
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
      description: 'The created time entry',
      properties: TIME_ENTRY_OUTPUT_PROPERTIES,
    },
  },
}
