import type { KalshiAuthParams } from '@/tools/kalshi/types'
import { buildKalshiAuthHeaders, buildKalshiUrl, handleKalshiError } from '@/tools/kalshi/types'
import type { ToolConfig } from '@/tools/types'

export interface KalshiGetBalanceParams extends KalshiAuthParams {}

export interface KalshiGetBalanceResponse {
  success: boolean
  output: {
    balance: number // In cents
    portfolioValue: number // In cents
  }
}

export const kalshiGetBalanceTool: ToolConfig<KalshiGetBalanceParams, KalshiGetBalanceResponse> = {
  id: 'kalshi_get_balance',
  name: 'Get Balance from Kalshi',
  description: 'Retrieve your account balance and portfolio value from Kalshi',
  version: '1.0.0',

  params: {
    keyId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Kalshi API Key ID',
    },
    privateKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your RSA Private Key (PEM format)',
    },
  },

  request: {
    url: () => buildKalshiUrl('/portfolio/balance'),
    method: 'GET',
    headers: (params) => {
      const path = '/trade-api/v2/portfolio/balance'
      return buildKalshiAuthHeaders(params.keyId, params.privateKey, 'GET', path)
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      handleKalshiError(data, response.status, 'get_balance')
    }

    const balance = data.balance ?? 0
    const portfolioValue = data.portfolio_value ?? 0

    return {
      success: true,
      output: {
        balance,
        portfolioValue,
      },
    }
  },

  outputs: {
    balance: { type: 'number', description: 'Account balance in cents' },
    portfolioValue: { type: 'number', description: 'Portfolio value in cents' },
  },
}

/**
 * V2 Params for Get Balance
 */
export interface KalshiGetBalanceV2Params extends KalshiAuthParams {}

/**
 * V2 Response matching Kalshi API exactly
 */
export interface KalshiGetBalanceV2Response {
  success: boolean
  output: {
    balance: number
    portfolio_value: number
    updated_ts: number | null
  }
}

export const kalshiGetBalanceV2Tool: ToolConfig<
  KalshiGetBalanceV2Params,
  KalshiGetBalanceV2Response
> = {
  id: 'kalshi_get_balance_v2',
  name: 'Get Balance from Kalshi V2',
  description:
    'Retrieve your account balance and portfolio value from Kalshi (V2 - exact API response)',
  version: '2.0.0',

  params: {
    keyId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Kalshi API Key ID',
    },
    privateKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your RSA Private Key (PEM format)',
    },
  },

  request: {
    url: () => buildKalshiUrl('/portfolio/balance'),
    method: 'GET',
    headers: (params) => {
      const path = '/trade-api/v2/portfolio/balance'
      return buildKalshiAuthHeaders(params.keyId, params.privateKey, 'GET', path)
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      handleKalshiError(data, response.status, 'get_balance_v2')
    }

    return {
      success: true,
      output: {
        balance: data.balance ?? 0,
        portfolio_value: data.portfolio_value ?? 0,
        updated_ts: data.updated_ts ?? null,
      },
    }
  },

  outputs: {
    balance: { type: 'number', description: 'Account balance in cents' },
    portfolio_value: { type: 'number', description: 'Portfolio value in cents' },
    updated_ts: { type: 'number', description: 'Unix timestamp of last update (milliseconds)' },
  },
}
