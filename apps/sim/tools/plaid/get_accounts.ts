import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid'
import type { GetAccountsParams, GetAccountsResponse } from '@/tools/plaid/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Plaid Get Accounts Tool
 * Uses official plaid SDK for account information retrieval
 */
export const plaidGetAccountsTool: ToolConfig<GetAccountsParams, GetAccountsResponse> = {
  id: 'plaid_get_accounts',
  name: 'Plaid Get Accounts',
  description: 'Retrieve account information from Plaid',
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
   * Retrieves account details and metadata
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

      // Get accounts using SDK
      const response = await plaidClient.accountsGet(request)
      const data = response.data

      return {
        success: true,
        output: {
          accounts: data.accounts,
          item: data.item,
          metadata: {
            count: data.accounts.length,
            item_id: data.item.item_id,
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
        error: `PLAID_ACCOUNTS_ERROR: Failed to retrieve accounts from Plaid - ${errorDetails}`,
      }
    }
  },

  outputs: {
    accounts: {
      type: 'json',
      description: 'Array of Plaid account objects',
    },
    item: {
      type: 'json',
      description: 'Plaid item metadata',
    },
    metadata: {
      type: 'json',
      description: 'Accounts metadata',
    },
  },
}
