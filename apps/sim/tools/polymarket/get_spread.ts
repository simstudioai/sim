import type { PolymarketSpread } from '@/tools/polymarket/types'
import { buildClobUrl, handlePolymarketError } from '@/tools/polymarket/types'
import type { ToolConfig } from '@/tools/types'

export interface PolymarketGetSpreadParams {
  tokenId: string // The token ID (CLOB token ID from market)
}

export interface PolymarketGetSpreadResponse {
  success: boolean
  output: {
    spread: PolymarketSpread
  }
}

export const polymarketGetSpreadTool: ToolConfig<
  PolymarketGetSpreadParams,
  PolymarketGetSpreadResponse
> = {
  id: 'polymarket_get_spread',
  name: 'Get Spread from Polymarket',
  description: 'Retrieve the bid-ask spread for a specific token',
  version: '1.0.0',

  params: {
    tokenId: {
      type: 'string',
      required: true,
      description:
        'The CLOB token ID from market clobTokenIds array (e.g., "71321045679252212594626385532706912750332728571942532289631379312455583992563").',
      visibility: 'user-or-llm',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      queryParams.append('token_id', params.tokenId)
      return `${buildClobUrl('/spread')}?${queryParams.toString()}`
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      handlePolymarketError(data, response.status, 'get_spread')
    }

    return {
      success: true,
      output: {
        spread: {
          spread: data.spread ?? '',
        },
      },
    }
  },

  outputs: {
    spread: {
      type: 'object',
      description: 'Spread value between bid and ask',
      properties: {
        spread: { type: 'string', description: 'The spread value' },
      },
    },
  },
}
