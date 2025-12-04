import type { ToolConfig } from '@/tools/types'
import type { KalshiExchangeStatus } from './types'
import { buildKalshiUrl, handleKalshiError } from './types'

export type KalshiGetExchangeStatusParams = Record<string, never>

export interface KalshiGetExchangeStatusResponse {
  success: boolean
  output: {
    exchangeStatus: KalshiExchangeStatus
    metadata: {
      operation: 'get_exchange_status'
    }
    success: boolean
  }
}

export const kalshiGetExchangeStatusTool: ToolConfig<
  KalshiGetExchangeStatusParams,
  KalshiGetExchangeStatusResponse
> = {
  id: 'kalshi_get_exchange_status',
  name: 'Get Exchange Status from Kalshi',
  description: 'Retrieve the current status of the Kalshi exchange (trading and exchange activity)',
  version: '1.0.0',

  params: {},

  request: {
    url: () => {
      return buildKalshiUrl('/exchange/status')
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      handleKalshiError(data, response.status, 'get_exchange_status')
    }

    const exchangeStatus = {
      trading_active: data.trading_active ?? false,
      exchange_active: data.exchange_active ?? false,
    }

    return {
      success: true,
      output: {
        exchangeStatus,
        metadata: {
          operation: 'get_exchange_status' as const,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Exchange status data and metadata',
      properties: {
        exchangeStatus: { type: 'object', description: 'Exchange status object' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
