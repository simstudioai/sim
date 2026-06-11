import type { RampGetLimitParams, RampGetLimitResponse } from '@/tools/ramp/types'
import { buildRampHeaders, buildRampUrl, extractRampError } from '@/tools/ramp/utils'
import type { ToolConfig } from '@/tools/types'

export const rampGetLimitTool: ToolConfig<RampGetLimitParams, RampGetLimitResponse> = {
  id: 'ramp_get_limit',
  name: 'Ramp Get Limit',
  description: 'Retrieve a single Ramp spend limit by ID',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'ramp',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for the Ramp API',
    },
    limitId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the spend limit to retrieve',
    },
  },

  request: {
    url: (params) => buildRampUrl(`/limits/${encodeURIComponent(params.limitId.trim())}`),
    method: 'GET',
    headers: (params) => buildRampHeaders(params),
  },

  transformResponse: async (response): Promise<RampGetLimitResponse> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: extractRampError(data, 'Failed to get Ramp limit'),
        output: {},
      }
    }

    return {
      success: true,
      output: {
        limit: data,
      },
    }
  },

  outputs: {
    limit: {
      type: 'object',
      description: 'The requested Ramp spend limit',
      properties: {
        id: { type: 'string', description: 'Unique identifier for the spend limit' },
        display_name: { type: 'string', description: 'Display name of the spend limit' },
        state: { type: 'string', description: 'State of the spend limit (e.g. ACTIVE)' },
        balance: {
          type: 'object',
          description:
            'Balance of the spend limit (cleared, pending, and total canonical amounts in the smallest currency denomination)',
        },
        users: { type: 'array', description: 'Users the spend limit applies to' },
        cards: { type: 'array', description: 'Cards attached to the spend limit' },
        spend_program_id: { type: 'string', description: 'ID of the associated spend program' },
      },
    },
  },
}
