import type { RampGetBusinessParams, RampGetBusinessResponse } from '@/tools/ramp/types'
import { buildRampHeaders, buildRampUrl, extractRampError } from '@/tools/ramp/utils'
import type { ToolConfig } from '@/tools/types'

export const rampGetBusinessTool: ToolConfig<RampGetBusinessParams, RampGetBusinessResponse> = {
  id: 'ramp_get_business',
  name: 'Ramp Get Business',
  description: 'Retrieve information about the authorized Ramp business',
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
  },

  request: {
    url: () => buildRampUrl('/business'),
    method: 'GET',
    headers: (params) => buildRampHeaders(params),
  },

  transformResponse: async (response): Promise<RampGetBusinessResponse> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: extractRampError(data, 'Failed to get Ramp business'),
        output: {},
      }
    }

    return {
      success: true,
      output: {
        business: data,
      },
    }
  },

  outputs: {
    business: {
      type: 'object',
      description: 'The authorized Ramp business',
      properties: {
        id: { type: 'string', description: 'Unique identifier for the business' },
        business_name_legal: { type: 'string', description: 'Legal name of the business' },
        business_name_on_card: { type: 'string', description: 'Business name shown on cards' },
        active: { type: 'boolean', description: 'Whether the business account is active' },
        created_time: { type: 'string', description: 'When the business account was created' },
        is_reimbursements_enabled: {
          type: 'boolean',
          description: 'Whether reimbursements are enabled for the business',
        },
        website: { type: 'string', description: 'Company website URL' },
        phone: { type: 'string', description: 'Primary contact phone number' },
      },
    },
  },
}
