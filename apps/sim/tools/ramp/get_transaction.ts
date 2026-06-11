import type { RampGetTransactionParams, RampGetTransactionResponse } from '@/tools/ramp/types'
import { buildRampHeaders, buildRampUrl, extractRampError } from '@/tools/ramp/utils'
import type { ToolConfig } from '@/tools/types'

export const rampGetTransactionTool: ToolConfig<
  RampGetTransactionParams,
  RampGetTransactionResponse
> = {
  id: 'ramp_get_transaction',
  name: 'Ramp Get Transaction',
  description: 'Retrieve a single Ramp card transaction by ID',
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
    transactionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the transaction to retrieve',
    },
  },

  request: {
    url: (params) =>
      buildRampUrl(`/transactions/${encodeURIComponent(params.transactionId.trim())}`),
    method: 'GET',
    headers: (params) => buildRampHeaders(params),
  },

  transformResponse: async (response): Promise<RampGetTransactionResponse> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: extractRampError(data, 'Failed to get Ramp transaction'),
        output: {},
      }
    }

    return {
      success: true,
      output: {
        transaction: data,
      },
    }
  },

  outputs: {
    transaction: {
      type: 'object',
      description: 'The requested Ramp transaction',
      properties: {
        id: { type: 'string', description: 'Unique identifier for the transaction' },
        amount: { type: 'number', description: 'Settled amount in U.S. dollars' },
        currency_code: { type: 'string', description: 'ISO 4217 currency code' },
        merchant_name: { type: 'string', description: 'Name of the merchant' },
        memo: { type: 'string', description: 'Memo attached to the transaction' },
        state: { type: 'string', description: 'Transaction state (e.g. CLEARED, PENDING)' },
        user_transaction_time: { type: 'string', description: 'When the transaction occurred' },
        card_id: { type: 'string', description: 'ID of the card used' },
        card_holder: { type: 'object', description: 'Cardholder details (user and department)' },
        receipts: { type: 'array', description: 'IDs of receipts attached to the transaction' },
      },
    },
  },
}
