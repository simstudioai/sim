import type { KalshiExchangeStatus } from '@/tools/kalshi/types'
import { buildKalshiUrl, handleKalshiError } from '@/tools/kalshi/types'
import type { ToolConfig } from '@/tools/types'

export type KalshiGetExchangeStatusParams = Record<string, never>

export interface KalshiGetExchangeStatusResponse {
  success: boolean
  output: {
    status: KalshiExchangeStatus
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

    const status = {
      trading_active: data.trading_active ?? false,
      exchange_active: data.exchange_active ?? false,
    }

    return {
      success: true,
      output: {
        status,
      },
    }
  },

  outputs: {
    status: {
      type: 'object',
      description: 'Exchange status with trading_active and exchange_active flags',
    },
  },
}

/**
 * V2 Params for Get Exchange Status
 */
export type KalshiGetExchangeStatusV2Params = Record<string, never>

/**
 * V2 Response matching Kalshi API exactly
 */
export interface KalshiGetExchangeStatusV2Response {
  success: boolean
  output: {
    exchange_active: boolean
    trading_active: boolean
    exchange_estimated_resume_time: string | null
  }
}

export const kalshiGetExchangeStatusV2Tool: ToolConfig<
  KalshiGetExchangeStatusV2Params,
  KalshiGetExchangeStatusV2Response
> = {
  id: 'kalshi_get_exchange_status_v2',
  name: 'Get Exchange Status from Kalshi V2',
  description: 'Retrieve the current status of the Kalshi exchange (V2 - exact API response)',
  version: '2.0.0',

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
      handleKalshiError(data, response.status, 'get_exchange_status_v2')
    }

    return {
      success: true,
      output: {
        exchange_active: data.exchange_active ?? false,
        trading_active: data.trading_active ?? false,
        exchange_estimated_resume_time: data.exchange_estimated_resume_time ?? null,
      },
    }
  },

  outputs: {
    exchange_active: {
      type: 'boolean',
      description: 'Whether the exchange is active',
    },
    trading_active: {
      type: 'boolean',
      description: 'Whether trading is active',
    },
    exchange_estimated_resume_time: {
      type: 'string',
      description: 'Estimated time when exchange will resume (if inactive)',
    },
  },
}
