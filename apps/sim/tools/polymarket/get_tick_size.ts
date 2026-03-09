import { buildClobUrl, handlePolymarketError } from '@/tools/polymarket/types'
import type { ToolConfig } from '@/tools/types'

export interface PolymarketGetTickSizeParams {
  tokenId: string // The token ID (CLOB token ID from market)
}

export interface PolymarketGetTickSizeResponse {
  success: boolean
  output: {
    tickSize: string
  }
}

export const polymarketGetTickSizeTool: ToolConfig<
  PolymarketGetTickSizeParams,
  PolymarketGetTickSizeResponse
> = {
  id: 'polymarket_get_tick_size',
  name: 'Get Tick Size from Polymarket',
  description: 'Retrieve the minimum tick size for a specific token',
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
      return `${buildClobUrl('/tick-size')}?${queryParams.toString()}`
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      handlePolymarketError(data, response.status, 'get_tick_size')
    }

    // API returns { minimum_tick_size: "0.01" }
    const tickSize =
      typeof data === 'string' ? data : data.minimum_tick_size || data.tick_size || ''

    return {
      success: true,
      output: {
        tickSize: String(tickSize),
      },
    }
  },

  outputs: {
    tickSize: {
      type: 'string',
      description: 'Minimum tick size',
    },
  },
}
