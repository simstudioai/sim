import type {
  TemporalDeleteScheduleParams,
  TemporalScheduleMutationResponse,
} from '@/tools/temporal/types'
import {
  parseTemporalResponse,
  TEMPORAL_CLIENT_IDENTITY,
  temporalRequestHeaders,
  temporalScheduleUrl,
} from '@/tools/temporal/utils'
import type { ToolConfig } from '@/tools/types'

export const deleteScheduleTool: ToolConfig<
  TemporalDeleteScheduleParams,
  TemporalScheduleMutationResponse
> = {
  id: 'temporal_delete_schedule',
  name: 'Temporal Delete Schedule',
  description:
    'Delete a Temporal schedule. Workflows already started by the schedule keep running.',
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
      description: 'ID of the schedule to delete',
    },
  },

  request: {
    url: (params) =>
      `${temporalScheduleUrl(params.serverUrl, params.namespace, params.scheduleId)}?identity=${encodeURIComponent(TEMPORAL_CLIENT_IDENTITY)}`,
    method: 'DELETE',
    headers: (params) => temporalRequestHeaders(params),
  },

  transformResponse: async (response: Response, params) => {
    await parseTemporalResponse(response, 'delete schedule')
    return {
      success: true,
      output: {
        scheduleId: params?.scheduleId ?? '',
      },
    }
  },

  outputs: {
    scheduleId: { type: 'string', description: 'ID of the deleted schedule' },
  },
}
