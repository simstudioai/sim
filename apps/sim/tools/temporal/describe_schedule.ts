import type {
  TemporalDescribeScheduleParams,
  TemporalDescribeScheduleResponse,
} from '@/tools/temporal/types'
import {
  parseTemporalResponse,
  temporalRequestHeaders,
  temporalScheduleUrl,
} from '@/tools/temporal/utils'
import type { ToolConfig } from '@/tools/types'

interface RawDescribeScheduleResponse {
  schedule?: {
    spec?: Record<string, unknown>
    action?: {
      startWorkflow?: {
        workflowId?: string
        workflowType?: { name?: string }
        taskQueue?: { name?: string }
      }
    }
    state?: {
      notes?: string
      paused?: boolean
    }
  }
  info?: {
    recentActions?: Array<{
      scheduleTime?: string
      actualTime?: string
      startWorkflowResult?: { workflowId?: string; runId?: string }
    }>
    futureActionTimes?: string[]
  }
}

export const describeScheduleTool: ToolConfig<
  TemporalDescribeScheduleParams,
  TemporalDescribeScheduleResponse
> = {
  id: 'temporal_describe_schedule',
  name: 'Temporal Describe Schedule',
  description:
    'Get the configuration and current state of a Temporal schedule, including its spec, recent actions, and upcoming run times.',
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
      description: 'ID of the schedule to describe',
    },
  },

  request: {
    url: (params) => temporalScheduleUrl(params.serverUrl, params.namespace, params.scheduleId),
    method: 'GET',
    headers: (params) => temporalRequestHeaders(params),
  },

  transformResponse: async (response: Response, params) => {
    const data = await parseTemporalResponse<RawDescribeScheduleResponse>(
      response,
      'describe schedule'
    )
    const startWorkflow = data.schedule?.action?.startWorkflow

    return {
      success: true,
      output: {
        scheduleId: params?.scheduleId ?? '',
        paused: data.schedule?.state?.paused ?? false,
        notes: data.schedule?.state?.notes ?? null,
        workflowType: startWorkflow?.workflowType?.name ?? null,
        taskQueue: startWorkflow?.taskQueue?.name ?? null,
        workflowId: startWorkflow?.workflowId ?? null,
        spec: data.schedule?.spec ?? null,
        recentActions: (data.info?.recentActions ?? []).map((action) => ({
          scheduleTime: action.scheduleTime ?? null,
          actualTime: action.actualTime ?? null,
          workflowId: action.startWorkflowResult?.workflowId ?? null,
          runId: action.startWorkflowResult?.runId ?? null,
        })),
        futureActionTimes: data.info?.futureActionTimes ?? [],
      },
    }
  },

  outputs: {
    scheduleId: { type: 'string', description: 'Schedule ID' },
    paused: { type: 'boolean', description: 'Whether the schedule is paused' },
    notes: { type: 'string', description: 'Human-readable notes on the schedule', optional: true },
    workflowType: {
      type: 'string',
      description: 'Workflow type the schedule starts',
      optional: true,
    },
    taskQueue: {
      type: 'string',
      description: 'Task queue used for started workflows',
      optional: true,
    },
    workflowId: {
      type: 'string',
      description: 'Workflow ID template for started workflows',
      optional: true,
    },
    spec: {
      type: 'json',
      description: 'Schedule spec (calendars, intervals, cron strings, jitter, time zone)',
      optional: true,
    },
    recentActions: {
      type: 'array',
      description: 'Most recent actions taken by the schedule',
      items: {
        type: 'object',
        properties: {
          scheduleTime: { type: 'string', description: 'Nominal scheduled time (RFC 3339)' },
          actualTime: { type: 'string', description: 'Actual time the action ran (RFC 3339)' },
          workflowId: { type: 'string', description: 'Workflow ID of the started execution' },
          runId: { type: 'string', description: 'Run ID of the started execution' },
        },
      },
    },
    futureActionTimes: { type: 'json', description: 'Upcoming action times (RFC 3339)' },
  },
}
