import {
  ROCKETLANE_API_BASE,
  type RocketlaneTimeOffDeleteParams,
  type RocketlaneTimeOffDeleteResponse,
  rocketlaneError,
  rocketlaneHeaders,
} from '@/tools/rocketlane/types'
import type { ToolConfig } from '@/tools/types'

export const rocketlaneDeleteTimeOffTool: ToolConfig<
  RocketlaneTimeOffDeleteParams,
  RocketlaneTimeOffDeleteResponse
> = {
  id: 'rocketlane_delete_time_off',
  name: 'Rocketlane Delete Time-Off',
  description: 'Permanently delete a Rocketlane time-off by its ID',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rocketlane API key',
    },
    timeOffId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique identifier of the time-off to delete',
    },
  },

  request: {
    url: (params) => `${ROCKETLANE_API_BASE}/time-offs/${encodeURIComponent(params.timeOffId)}`,
    method: 'DELETE',
    headers: (params) => rocketlaneHeaders(params.apiKey),
  },

  transformResponse: async (response: Response, params?: RocketlaneTimeOffDeleteParams) => {
    if (!response.ok) {
      throw new Error(await rocketlaneError(response))
    }
    return {
      success: true,
      output: { deleted: true, timeOffId: params?.timeOffId ?? null },
    }
  },

  outputs: {
    deleted: { type: 'boolean', description: 'Whether the time-off was deleted' },
    timeOffId: {
      type: 'number',
      description: 'ID of the deleted time-off',
      optional: true,
    },
  },
}
