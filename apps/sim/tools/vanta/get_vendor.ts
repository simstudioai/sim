import type { ToolConfig } from '@/tools/types'
import { VANTA_VENDOR_OUTPUT_PROPERTIES } from '@/tools/vanta/outputs'
import type { VantaGetVendorParams, VantaGetVendorResponse } from '@/tools/vanta/types'
import { createVantaTransformResponse, VANTA_QUERY_ROUTE } from '@/tools/vanta/utils'

export const vantaGetVendorTool: ToolConfig<VantaGetVendorParams, VantaGetVendorResponse> = {
  id: 'vanta_get_vendor',
  name: 'Vanta Get Vendor',
  description:
    'Get a Vanta vendor by ID, including risk levels, contract details, and authentication info',
  version: '1.0.0',

  params: {
    clientId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Vanta OAuth application client ID',
    },
    clientSecret: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Vanta OAuth application client secret',
    },
    region: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Vanta API region: "us" (api.vanta.com, default) or "gov" (api.vanta-gov.com)',
    },
    vendorId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique ID of the vendor',
    },
  },

  request: {
    url: VANTA_QUERY_ROUTE,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      operation: 'vanta_get_vendor',
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      region: params.region,
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
