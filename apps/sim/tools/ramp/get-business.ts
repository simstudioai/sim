import type { RampGetBusinessParams, RampGetBusinessResponse } from '@/tools/ramp/types'
import { RAMP_BUSINESS_PROPERTIES } from '@/tools/ramp/types'
import { buildRampHeaders, parseRampResponse, projectBusiness } from '@/tools/ramp/utils'
import type { ToolConfig } from '@/tools/types'

export const rampGetBusinessTool: ToolConfig<RampGetBusinessParams, RampGetBusinessResponse> = {
  id: 'ramp_get_business',
  name: 'Ramp Get Business',
  description: 'Fetch the company information in Ramp',
  version: '1.0.0',
  oauth: { required: true, provider: 'ramp' },
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Ramp OAuth access token',
    },
  },
  request: {
    url: 'https://api.ramp.com/developer/v1/business',
    method: 'GET',
    headers: (params) => buildRampHeaders(params.accessToken),
  },
  transformResponse: async (response) => {
    const data = await parseRampResponse(response)
    return { success: true, output: { business: projectBusiness(data) } }
  },
  outputs: {
    business: {
      type: 'json',
      description: 'Business details',
      properties: RAMP_BUSINESS_PROPERTIES,
    },
  },
}
