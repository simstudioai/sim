import type { RampGetSpendProgramParams, RampGetSpendProgramResponse } from '@/tools/ramp/types'
import { buildRampHeaders, buildRampUrl, extractRampError } from '@/tools/ramp/utils'
import type { ToolConfig } from '@/tools/types'

export const rampGetSpendProgramTool: ToolConfig<
  RampGetSpendProgramParams,
  RampGetSpendProgramResponse
> = {
  id: 'ramp_get_spend_program',
  name: 'Ramp Get Spend Program',
  description: 'Retrieve a single Ramp spend program by ID',
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
    spendProgramId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the spend program to retrieve',
    },
  },

  request: {
    url: (params) =>
      buildRampUrl(`/spend-programs/${encodeURIComponent(params.spendProgramId.trim())}`),
    method: 'GET',
    headers: (params) => buildRampHeaders(params),
  },

  transformResponse: async (response): Promise<RampGetSpendProgramResponse> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: extractRampError(data, 'Failed to get Ramp spend program'),
        output: {},
      }
    }

    return {
      success: true,
      output: {
        spendProgram: data,
      },
    }
  },

  outputs: {
    spendProgram: {
      type: 'object',
      description: 'The requested Ramp spend program',
      properties: {
        id: { type: 'string', description: 'Unique identifier for the spend program' },
        display_name: { type: 'string', description: 'Display name of the spend program' },
        description: { type: 'string', description: 'Description of the spend program' },
        is_shareable: {
          type: 'boolean',
          description: 'Whether limits under this program can be shared',
        },
        permitted_spend_types: {
          type: 'object',
          description: 'Spend types permitted by the program (card and/or reimbursement)',
        },
        restrictions: { type: 'object', description: 'Spending restrictions of the program' },
      },
    },
  },
}
