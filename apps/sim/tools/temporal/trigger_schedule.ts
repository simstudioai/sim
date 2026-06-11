import { generateId } from '@sim/utils/id'
import type {
  TemporalScheduleMutationResponse,
  TemporalTriggerScheduleParams,
} from '@/tools/temporal/types'
import {
  parseTemporalResponse,
  TEMPORAL_CLIENT_IDENTITY,
  temporalRequestHeaders,
  temporalScheduleUrl,
} from '@/tools/temporal/utils'
import type { ToolConfig } from '@/tools/types'

export const triggerScheduleTool: ToolConfig<
  TemporalTriggerScheduleParams,
  TemporalScheduleMutationResponse
> = {
  id: 'temporal_trigger_schedule',
  name: 'Temporal Trigger Schedule',
  description: 'Trigger an immediate action of a Temporal schedule, outside its normal spec.',
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
      description: 'ID of the schedule to trigger',
    },
    overlapPolicy: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        "Overlap policy for the triggered action (defaults to the schedule's policy): SCHEDULE_OVERLAP_POLICY_SKIP, SCHEDULE_OVERLAP_POLICY_BUFFER_ONE, SCHEDULE_OVERLAP_POLICY_BUFFER_ALL, SCHEDULE_OVERLAP_POLICY_CANCEL_OTHER, SCHEDULE_OVERLAP_POLICY_TERMINATE_OTHER, or SCHEDULE_OVERLAP_POLICY_ALLOW_ALL",
    },
  },

  request: {
    url: (params) =>
      `${temporalScheduleUrl(params.serverUrl, params.namespace, params.scheduleId)}/patch`,
    method: 'POST',
    headers: (params) => temporalRequestHeaders(params),
    body: (params) => {
      const triggerImmediately: Record<string, string> = {}
      if (params.overlapPolicy) triggerImmediately.overlapPolicy = params.overlapPolicy
      return {
        patch: { triggerImmediately },
        identity: TEMPORAL_CLIENT_IDENTITY,
        requestId: generateId(),
      }
    },
  },

  transformResponse: async (response: Response, params) => {
    await parseTemporalResponse(response, 'trigger schedule')
    return {
      success: true,
      output: {
        scheduleId: params?.scheduleId ?? '',
      },
    }
  },

  outputs: {
    scheduleId: { type: 'string', description: 'ID of the triggered schedule' },
  },
}
