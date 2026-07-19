import {
  mapTimeOff,
  ROCKETLANE_API_BASE,
  type RocketlaneTimeOffGetParams,
  type RocketlaneTimeOffResponse,
  rocketlaneError,
  rocketlaneHeaders,
  TIME_OFF_OUTPUT_PROPERTIES,
} from '@/tools/rocketlane/types'
import type { ToolConfig } from '@/tools/types'

export const rocketlaneGetTimeOffTool: ToolConfig<
  RocketlaneTimeOffGetParams,
  RocketlaneTimeOffResponse
> = {
  id: 'rocketlane_get_time_off',
  name: 'Rocketlane Get Time-Off',
  description: 'Retrieve a Rocketlane time-off by its ID',
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
      description: 'Unique identifier of the time-off',
    },
    includeFields: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional fields to include in the response: note, notifyUsers',
      items: { type: 'string' },
    },
    includeAllFields: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return all fields in the response',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(
        `${ROCKETLANE_API_BASE}/time-offs/${encodeURIComponent(params.timeOffId)}`
      )
      if (params.includeFields?.length) {
        url.searchParams.set('includeFields', params.includeFields.join(','))
      }
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
      output: { timeOff: mapTimeOff(data) },
    }
  },

  outputs: {
    timeOff: {
      type: 'object',
      description: 'The requested time-off',
      properties: TIME_OFF_OUTPUT_PROPERTIES,
    },
  },
}
