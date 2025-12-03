import type { ToolConfig } from '@/tools/types'
import { buildClobUrl, handlePolymarketError } from './types'

export interface PolymarketGetTickSizeParams {
  tokenId: string // The token ID (CLOB token ID from market)
}

export interface PolymarketGetTickSizeResponse {
  success: boolean
  output: {
    tickSize: string
    metadata: {
      operation: 'get_tick_size'
      tokenId: string
    }
    success: boolean
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
      description: 'The CLOB token ID (from market clobTokenIds)',
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

  transformResponse: async (response: Response, params) => {
    const data = await response.json()

    if (!response.ok) {
      handlePolymarketError(data, response.status, 'get_tick_size')
    }

    return {
      success: true,
      output: {
        tickSize: typeof data === 'string' ? data : data.tick_size || data.tickSize || '',
        metadata: {
          operation: 'get_tick_size' as const,
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
      description: 'Tick size and metadata',
      properties: {
        tickSize: { type: 'string', description: 'Minimum tick size' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
