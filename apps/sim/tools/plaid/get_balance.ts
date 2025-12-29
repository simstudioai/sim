import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid'
import type { GetBalanceParams, GetBalanceResponse } from '@/tools/plaid/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Plaid Get Balance Tool
 * Uses official plaid SDK for real-time balance retrieval
 */
export const plaidGetBalanceTool: ToolConfig<GetBalanceParams, GetBalanceResponse> = {
  id: 'plaid_get_balance',
  name: 'Plaid Get Balance',
  description: 'Retrieve real-time account balance information from Plaid',
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
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Plaid access token',
    },
    accountIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional array of account IDs to filter',
    },
  },

  /**
   * SDK-based execution using plaid PlaidApi
   * Retrieves account balances with automatic rate limiting
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

      // Prepare request
      const request: any = {
        access_token: params.accessToken,
      }

      if (params.accountIds && params.accountIds.length > 0) {
        request.options = {
          account_ids: params.accountIds,
        }
      }

      // Get balances using SDK
      const response = await plaidClient.accountsBalanceGet(request)
      const data = response.data

      // Calculate totals
      let totalAvailable = 0
      let totalCurrent = 0

      data.accounts.forEach((account: any) => {
        if (account.balances.available !== null) {
          totalAvailable += account.balances.available
        }
        if (account.balances.current !== null) {
          totalCurrent += account.balances.current
        }
      })

      return {
        success: true,
        output: {
          accounts: data.accounts,
          metadata: {
            count: data.accounts.length,
            total_available: totalAvailable,
            total_current: totalCurrent,
          },
        },
      }
    } catch (error: any) {
      const errorDetails = error.response?.data
        ? JSON.stringify(error.response.data)
        : error.message || 'Unknown error'
      return {
        success: false,
        output: {},
        error: `PLAID_BALANCE_ERROR: Failed to retrieve account balances from Plaid - ${errorDetails}`,
      }
    }
  },

  outputs: {
    accounts: {
      type: 'json',
      description: 'Array of accounts with balance information',
    },
    metadata: {
      type: 'json',
      description: 'Balance summary metadata',
    },
  },
}
