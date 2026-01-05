import type { ToolConfig } from '@/tools/types'
import type { KalshiAuthParams } from './types'
import { buildKalshiAuthHeaders, buildKalshiUrl, handleKalshiError } from './types'

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
