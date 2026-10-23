import type { RampGetVendorParams, RampGetVendorResponse } from '@/tools/ramp/types'
import { RAMP_VENDOR_PROPERTIES } from '@/tools/ramp/types'
import { buildRampHeaders, parseRampResponse, projectVendor } from '@/tools/ramp/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const rampGetVendorTool: ToolConfig<RampGetVendorParams, RampGetVendorResponse> = {
  id: 'ramp_get_vendor',
  name: 'Ramp Get Vendor',
  description: 'Fetch a vendor in Ramp',
  version: '1.0.0',
  oauth: { required: true, provider: 'ramp' },
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Ramp OAuth access token',
    },
    vendor_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Vendor id',
    },
  },
  request: {
    url: (params) =>
      `https://api.ramp.com/developer/v1/vendors/${safeUrlPathSegment(params.vendor_id, 'vendor_id')}`,
    method: 'GET',
    headers: (params) => buildRampHeaders(params.accessToken),
  },
  transformResponse: async (response) => {
    const data = await parseRampResponse(response)
    return { success: true, output: { vendor: projectVendor(data) } }
  },
  outputs: {
    vendor: { type: 'json', description: 'Vendor details', properties: RAMP_VENDOR_PROPERTIES },
  },
}
