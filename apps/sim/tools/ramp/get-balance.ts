import type { RampGetBalanceParams, RampGetBalanceResponse } from '@/tools/ramp/types'
import { RAMP_BALANCE_PROPERTIES } from '@/tools/ramp/types'
import { buildRampHeaders, parseRampResponse, projectBalance } from '@/tools/ramp/utils'
import type { ToolConfig } from '@/tools/types'

export const rampGetBalanceTool: ToolConfig<RampGetBalanceParams, RampGetBalanceResponse> = {
  id: 'ramp_get_balance',
  name: 'Ramp Get Balance',
  description: 'Fetch the company balance information in Ramp',
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
    url: 'https://api.ramp.com/developer/v1/business/balance',
    method: 'GET',
    headers: (params) => buildRampHeaders(params.accessToken),
  },
  transformResponse: async (response) => {
    const data = await parseRampResponse(response)
    return { success: true, output: { balance: projectBalance(data) } }
  },
  outputs: {
    balance: { type: 'json', description: 'Balance details', properties: RAMP_BALANCE_PROPERTIES },
  },
}
