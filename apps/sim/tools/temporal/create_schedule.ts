import { generateId } from '@sim/utils/id'
import type {
  TemporalCreateScheduleParams,
  TemporalScheduleMutationResponse,
} from '@/tools/temporal/types'
import {
  parseJsonArgs,
  parseTemporalResponse,
  TEMPORAL_CLIENT_IDENTITY,
  temporalRequestHeaders,
  temporalScheduleUrl,
  toDurationString,
} from '@/tools/temporal/utils'
import type { ToolConfig } from '@/tools/types'

export const createScheduleTool: ToolConfig<
  TemporalCreateScheduleParams,
  TemporalScheduleMutationResponse
> = {
  id: 'temporal_create_schedule',
  name: 'Temporal Create Schedule',
  description: 'Create a Temporal schedule that starts a workflow on a cron or interval cadence.',
  version: '1.0.0',

  params: {
    serverUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: "Base URL of the Temporal server's HTTP API (e.g., http://localhost:7243)",
    },
    namespace: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Temporal namespace (e.g., default)',
    },
    apiKey: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'API key sent as a Bearer token (leave blank for servers without auth)',
    },
    scheduleId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique ID for the new schedule (e.g., nightly-report)',
    },
    workflowId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Workflow ID for started workflows (the schedule appends the run time to keep IDs unique)',
    },
    workflowType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Registered workflow type name the schedule starts (e.g., ReportWorkflow)',
    },
    taskQueue: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Task queue the workflow worker polls (e.g., reports)',
    },
    input: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Workflow input as JSON. A top-level array is passed as the argument list (one argument per element); any other value is passed as a single argument',
    },
    cronExpressions: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Cron expressions defining when the schedule fires, comma- or newline-separated for multiple (e.g., "0 12 * * *"). At least one of cronExpressions or intervalSeconds is required',
    },
    intervalSeconds: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Fixed interval between actions in seconds. At least one of cronExpressions or intervalSeconds is required',
    },
    timezone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'IANA time zone for cron evaluation (e.g., America/New_York; defaults to UTC)',
    },
    overlapPolicy: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Policy when an action would overlap a still-running one (defaults to skip): SCHEDULE_OVERLAP_POLICY_SKIP, SCHEDULE_OVERLAP_POLICY_BUFFER_ONE, SCHEDULE_OVERLAP_POLICY_BUFFER_ALL, SCHEDULE_OVERLAP_POLICY_CANCEL_OTHER, SCHEDULE_OVERLAP_POLICY_TERMINATE_OTHER, or SCHEDULE_OVERLAP_POLICY_ALLOW_ALL',
    },
    notes: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Human-readable notes stored on the schedule',
    },
    paused: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Create the schedule in a paused state (defaults to active)',
    },
  },

  request: {
    url: (params) => temporalScheduleUrl(params.serverUrl, params.namespace, params.scheduleId),
    method: 'POST',
    headers: (params) => temporalRequestHeaders(params),
    body: (params) => {
      const cronString = (params.cronExpressions ?? '')
        .split(/[\n,]/)
        .map((expression) => expression.trim())
        .filter(Boolean)
      const interval = toDurationString(params.intervalSeconds)
      if (cronString.length === 0 && !interval) {
        throw new Error('At least one of cronExpressions or intervalSeconds is required')
      }

      const spec: Record<string, unknown> = {}
      if (cronString.length > 0) spec.cronString = cronString
      if (interval) spec.interval = [{ interval }]
      if (params.timezone?.trim()) spec.timezoneName = params.timezone.trim()

      const startWorkflow: Record<string, unknown> = {
        workflowId: params.workflowId.trim(),
        workflowType: { name: params.workflowType.trim() },
        taskQueue: { name: params.taskQueue.trim() },
      }
      const input = parseJsonArgs(params.input, 'input')
      if (input) startWorkflow.input = input

      const schedule: Record<string, unknown> = {
        spec,
        action: { startWorkflow },
      }
      if (params.overlapPolicy) schedule.policies = { overlapPolicy: params.overlapPolicy }
      const state: Record<string, unknown> = {}
      if (params.notes?.trim()) state.notes = params.notes.trim()
      if (params.paused) state.paused = true
      if (Object.keys(state).length > 0) schedule.state = state

      return {
        schedule,
        identity: TEMPORAL_CLIENT_IDENTITY,
        requestId: generateId(),
      }
    },
  },

  transformResponse: async (response: Response, params) => {
    await parseTemporalResponse(response, 'create schedule')
    return {
      success: true,
      output: {
        scheduleId: params?.scheduleId ?? '',
      },
    }
  },

  outputs: {
    scheduleId: { type: 'string', description: 'ID of the created schedule' },
  },
}
