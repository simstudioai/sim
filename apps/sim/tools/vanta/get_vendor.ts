import type { InternalToolConfig } from '@/tools/types'
import { VANTA_VENDOR_OUTPUT_PROPERTIES } from '@/tools/vanta/outputs'
import type { VantaGetVendorParams, VantaGetVendorResponse } from '@/tools/vanta/types'
import { createVantaTransformResponse } from '@/tools/vanta/utils'

export const vantaGetVendorTool: InternalToolConfig<VantaGetVendorParams, VantaGetVendorResponse> =
  {
    id: 'vanta_get_vendor',
    name: 'Vanta Get Vendor',
    description:
      'Get a Vanta vendor by ID, including risk levels, contract details, and authentication info',
    version: '1.0.0',

    oauth: { required: true, provider: 'vanta', authoritativeParams: ['apiDomain'] },

    params: {
      accessToken: {
        type: 'string',
        required: true,
        visibility: 'hidden',
        description: 'Access token supplied by the saved Vanta credential',
      },
      apiDomain: {
        type: 'string',
        required: true,
        visibility: 'hidden',
        description: 'API origin supplied by the saved Vanta credential',
      },
      vendorId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Unique ID of the vendor',
      },
    },

    operation: {
      input: (params) => ({
        operation: 'vanta_get_vendor',
        accessToken: params.accessToken,
        apiDomain: params.apiDomain,
        vendorId: params.vendorId,
      }),
    },

    transformResponse: createVantaTransformResponse<VantaGetVendorResponse>(
      'Failed to get Vanta vendor'
    ),

    outputs: {
      vendor: {
        type: 'json',
        description: 'The requested vendor',
        properties: VANTA_VENDOR_OUTPUT_PROPERTIES,
      },
    },
  }
