import { buildClobUrl, handlePolymarketError } from '@/tools/polymarket/types'
import type { ToolConfig } from '@/tools/types'

export interface PolymarketGetMidpointParams {
  tokenId: string // The token ID (CLOB token ID from market)
}

export interface PolymarketGetMidpointResponse {
  success: boolean
  output: {
    midpoint: string
  }
}

export const polymarketGetMidpointTool: ToolConfig<
  PolymarketGetMidpointParams,
  PolymarketGetMidpointResponse
> = {
  id: 'polymarket_get_midpoint',
  name: 'Get Midpoint Price from Polymarket',
  description: 'Retrieve the midpoint price for a specific token',
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
      return `${buildClobUrl('/midpoint')}?${queryParams.toString()}`
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      handlePolymarketError(data, response.status, 'get_midpoint')
    }

    return {
      success: true,
      output: {
        midpoint: data.mid || data.midpoint || data,
      },
    }
  },

  outputs: {
    midpoint: {
      type: 'string',
      description: 'Midpoint price',
    },
  },
}
