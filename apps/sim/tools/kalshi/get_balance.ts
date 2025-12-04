import type { ToolConfig } from '@/tools/types'
import type { KalshiAuthParams } from './types'
import { buildKalshiAuthHeaders, buildKalshiUrl, handleKalshiError } from './types'

export interface KalshiGetBalanceParams extends KalshiAuthParams {}

export interface KalshiGetBalanceResponse {
  success: boolean
  output: {
    balance: number // In cents
    portfolioValue?: number // In cents
    balanceDollars: number // Converted to dollars
    portfolioValueDollars?: number // Converted to dollars
    metadata: {
      operation: 'get_balance'
    }
    success: boolean
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
      description: 'Your Kalshi API Key ID',
    },
    privateKey: {
      type: 'string',
      required: true,
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

    const balance = data.balance || 0
    const portfolioValue = data.portfolio_value

    return {
      success: true,
      output: {
        balance,
        portfolioValue,
        balanceDollars: balance / 100,
        portfolioValueDollars: portfolioValue ? portfolioValue / 100 : undefined,
        metadata: {
          operation: 'get_balance' as const,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Balance data and metadata',
      properties: {
        balance: { type: 'number', description: 'Account balance in cents' },
        portfolioValue: { type: 'number', description: 'Portfolio value in cents' },
        balanceDollars: { type: 'number', description: 'Account balance in dollars' },
        portfolioValueDollars: { type: 'number', description: 'Portfolio value in dollars' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
