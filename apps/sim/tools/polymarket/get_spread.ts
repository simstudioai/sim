import type { ToolConfig } from '@/tools/types'
import type { PolymarketSpread } from './types'
import { buildClobUrl, handlePolymarketError } from './types'

export interface PolymarketGetSpreadParams {
  tokenId: string // The token ID (CLOB token ID from market)
}

export interface PolymarketGetSpreadResponse {
  success: boolean
  output: {
    spread: PolymarketSpread
    metadata: {
      operation: 'get_spread'
      tokenId: string
    }
    success: boolean
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
      description: 'The CLOB token ID (from market clobTokenIds)',
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

  transformResponse: async (response: Response, params) => {
    const data = await response.json()

    if (!response.ok) {
      handlePolymarketError(data, response.status, 'get_spread')
    }

    return {
      success: true,
      output: {
        spread: data,
        metadata: {
          operation: 'get_spread' as const,
          tokenId: params?.tokenId || '',
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Spread data and metadata',
      properties: {
        spread: { type: 'object', description: 'Bid-ask spread object' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
