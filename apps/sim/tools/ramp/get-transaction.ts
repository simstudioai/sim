import type { RampGetTransactionParams, RampGetTransactionResponse } from '@/tools/ramp/types'
import { RAMP_TRANSACTION_PROPERTIES } from '@/tools/ramp/types'
import { buildRampHeaders, parseRampResponse, projectTransaction } from '@/tools/ramp/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const rampGetTransactionTool: ToolConfig<
  RampGetTransactionParams,
  RampGetTransactionResponse
> = {
  id: 'ramp_get_transaction',
  name: 'Ramp Get Transaction',
  description: 'Fetch a transaction in Ramp',
  version: '1.0.0',
  oauth: { required: true, provider: 'ramp' },
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Ramp OAuth access token',
    },
    transaction_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Transaction id',
    },
  },
  request: {
    url: (params) =>
      `https://api.ramp.com/developer/v1/transactions/${safeUrlPathSegment(params.transaction_id, 'transaction_id')}`,
    method: 'GET',
    headers: (params) => buildRampHeaders(params.accessToken),
  },
  transformResponse: async (response) => {
    const data = await parseRampResponse(response)
    return { success: true, output: { transaction: projectTransaction(data) } }
  },
  outputs: {
    transaction: {
      type: 'json',
      description: 'Transaction details',
      properties: RAMP_TRANSACTION_PROPERTIES,
    },
  },
}
