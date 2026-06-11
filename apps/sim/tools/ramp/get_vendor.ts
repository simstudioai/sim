import type { RampGetVendorParams, RampGetVendorResponse } from '@/tools/ramp/types'
import { buildRampHeaders, buildRampUrl, extractRampError } from '@/tools/ramp/utils'
import type { ToolConfig } from '@/tools/types'

export const rampGetVendorTool: ToolConfig<RampGetVendorParams, RampGetVendorResponse> = {
  id: 'ramp_get_vendor',
  name: 'Ramp Get Vendor',
  description: 'Retrieve a single Ramp vendor by ID',
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
    vendorId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the vendor to retrieve',
    },
  },

  request: {
    url: (params) => buildRampUrl(`/vendors/${encodeURIComponent(params.vendorId.trim())}`),
    method: 'GET',
    headers: (params) => buildRampHeaders(params),
  },

  transformResponse: async (response): Promise<RampGetVendorResponse> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: extractRampError(data, 'Failed to get Ramp vendor'),
        output: {},
      }
    }

    return {
      success: true,
      output: {
        vendor: data,
      },
    }
  },

  outputs: {
    vendor: {
      type: 'object',
      description: 'The requested Ramp vendor',
      properties: {
        id: { type: 'string', description: 'Unique identifier for the vendor' },
        name: { type: 'string', description: 'Name of the vendor' },
        state: { type: 'string', description: 'State of the vendor record' },
        is_active: { type: 'boolean', description: 'Whether the vendor is active' },
        country: { type: 'string', description: 'Country of the vendor' },
        total_spend_ytd: {
          type: 'object',
          description:
            'Year-to-date spend with the vendor (integer amount in the smallest currency denomination plus currency code)',
        },
        total_spend_all_time: {
          type: 'object',
          description:
            'All-time spend with the vendor (integer amount in the smallest currency denomination plus currency code)',
        },
      },
    },
  },
}
