import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid'
import type { AccessTokenResponse, ExchangePublicTokenParams } from '@/tools/plaid/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Plaid Exchange Public Token Tool
 * Uses official plaid SDK for token exchange
 */
export const plaidExchangePublicTokenTool: ToolConfig<
  ExchangePublicTokenParams,
  AccessTokenResponse
> = {
  id: 'plaid_exchange_public_token',
  name: 'Plaid Exchange Public Token',
  description: 'Exchange a public token for an access token',
  version: '1.0.0',

  params: {
    clientId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Plaid client ID',
    },
    secret: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Plaid secret key',
    },
    publicToken: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Public token from Plaid Link',
    },
  },

  /**
   * SDK-based execution using plaid PlaidApi
   * Exchanges public token for persistent access token
   */
  directExecution: async (params) => {
    try {
      // Initialize Plaid SDK client
      const configuration = new Configuration({
        basePath: PlaidEnvironments.production,
        baseOptions: {
          headers: {
            'PLAID-CLIENT-ID': params.clientId,
            'PLAID-SECRET': params.secret,
          },
        },
      })

      const plaidClient = new PlaidApi(configuration)

      // Exchange public token using SDK
      const response = await plaidClient.itemPublicTokenExchange({
        public_token: params.publicToken,
      })
      const data = response.data

      return {
        success: true,
        output: {
          accessToken: {
            access_token: data.access_token,
            item_id: data.item_id,
            request_id: data.request_id,
          },
          metadata: {
            access_token: data.access_token,
            item_id: data.item_id,
          },
        },
      }
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: 'PLAID_EXCHANGE_TOKEN_ERROR',
          message: error.message || 'Failed to exchange public token',
          details: error.response?.data || error,
        },
      }
    }
  },

  outputs: {
    accessToken: {
      type: 'json',
      description: 'The access token object for making Plaid API calls',
    },
    metadata: {
      type: 'json',
      description: 'Access token metadata',
    },
  },
}
