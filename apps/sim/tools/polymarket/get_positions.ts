import type { ToolConfig } from '@/tools/types'
import type { PolymarketPosition } from './types'
import { buildDataUrl, handlePolymarketError } from './types'

export interface PolymarketGetPositionsParams {
  user: string // Wallet address (required)
  market?: string // Optional market filter
}

export interface PolymarketGetPositionsResponse {
  success: boolean
  output: {
    positions: PolymarketPosition[]
  }
}

export const polymarketGetPositionsTool: ToolConfig<
  PolymarketGetPositionsParams,
  PolymarketGetPositionsResponse
> = {
  id: 'polymarket_get_positions',
  name: 'Get Positions from Polymarket',
  description: 'Retrieve user positions from Polymarket',
  version: '1.0.0',

  params: {
    user: {
      type: 'string',
      required: true,
      description: 'User wallet address',
    },
    market: {
      type: 'string',
      required: false,
      description: 'Optional market ID to filter positions',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      queryParams.append('user', params.user)
      if (params.market) queryParams.append('market', params.market)

      return `${buildDataUrl('/positions')}?${queryParams.toString()}`
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      handlePolymarketError(data, response.status, 'get_positions')
    }

    // Response is an array of positions
    const positions = Array.isArray(data) ? data : []

    return {
      success: true,
      output: {
        positions,
      },
    }
  },

  outputs: {
    positions: {
      type: 'array',
      description: 'Array of position objects',
    },
  },
}
