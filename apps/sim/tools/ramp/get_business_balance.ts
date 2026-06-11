import type {
  RampGetBusinessBalanceParams,
  RampGetBusinessBalanceResponse,
} from '@/tools/ramp/types'
import { buildRampHeaders, buildRampUrl, extractRampError } from '@/tools/ramp/utils'
import type { ToolConfig } from '@/tools/types'

export const rampGetBusinessBalanceTool: ToolConfig<
  RampGetBusinessBalanceParams,
  RampGetBusinessBalanceResponse
> = {
  id: 'ramp_get_business_balance',
  name: 'Ramp Get Business Balance',
  description: 'Retrieve the current balance and limits of the authorized Ramp business',
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
    url: () => buildRampUrl('/business/balance'),
    method: 'GET',
    headers: (params) => buildRampHeaders(params),
  },

  transformResponse: async (response): Promise<RampGetBusinessBalanceResponse> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: extractRampError(data, 'Failed to get Ramp business balance'),
        output: {},
      }
    }

    return {
      success: true,
      output: {
        balance: data,
      },
    }
  },

  outputs: {
    balance: {
      type: 'object',
      description: 'Balance and limit details for the Ramp business',
      properties: {
        balance_including_pending: {
          type: 'number',
          description: 'Total balance including pending transactions, in U.S. dollars',
        },
        card_balance_including_pending: {
          type: 'number',
          description: 'Card balance including pending transactions, in U.S. dollars',
        },
        card_balance_excluding_pending: {
          type: 'number',
          description: 'Card balance excluding pending transactions, in U.S. dollars',
        },
        card_limit: { type: 'number', description: 'Total card limit in U.S. dollars' },
        available_card_limit: {
          type: 'number',
          description: 'Remaining available card limit in U.S. dollars',
        },
        card_limit_amount: {
          type: 'object',
          description:
            'Canonical card limit (integer amount in the smallest currency denomination plus currency code)',
        },
        available_card_limit_amount: {
          type: 'object',
          description:
            'Canonical available card limit (integer amount in the smallest currency denomination plus currency code)',
        },
      },
    },
  },
}
