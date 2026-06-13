import { generateId } from '@sim/utils/id'
import type {
  TemporalPatchScheduleParams,
  TemporalScheduleMutationResponse,
} from '@/tools/temporal/types'
import {
  parseTemporalResponse,
  TEMPORAL_CLIENT_IDENTITY,
  temporalRequestHeaders,
  temporalScheduleUrl,
} from '@/tools/temporal/utils'
import type { ToolConfig } from '@/tools/types'

export const pauseScheduleTool: ToolConfig<
  TemporalPatchScheduleParams,
  TemporalScheduleMutationResponse
> = {
  id: 'temporal_pause_schedule',
  name: 'Temporal Pause Schedule',
  description: 'Pause a Temporal schedule so it stops taking actions until unpaused.',
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
      description: 'ID of the schedule to pause',
    },
    reason: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "Reason recorded in the schedule's notes",
    },
  },

  request: {
    url: (params) =>
      `${temporalScheduleUrl(params.serverUrl, params.namespace, params.scheduleId)}/patch`,
    method: 'POST',
    headers: (params) => temporalRequestHeaders(params),
    body: (params) => ({
      patch: { pause: params.reason || 'Paused via Sim' },
      identity: TEMPORAL_CLIENT_IDENTITY,
      requestId: generateId(),
    }),
  },

  transformResponse: async (response: Response, params) => {
    await parseTemporalResponse(response, 'pause schedule')
    return {
      success: true,
      output: {
        scheduleId: params?.scheduleId ?? '',
      },
    }
  },

  outputs: {
    scheduleId: { type: 'string', description: 'ID of the paused schedule' },
  },
}
