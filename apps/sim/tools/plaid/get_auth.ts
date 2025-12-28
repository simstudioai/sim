import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid'
import type { GetAuthParams, GetAuthResponse } from '@/tools/plaid/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Plaid Get Auth Tool
 * Uses official plaid SDK for ACH/EFT routing information
 */
export const plaidGetAuthTool: ToolConfig<GetAuthParams, GetAuthResponse> = {
  id: 'plaid_get_auth',
  name: 'Plaid Get Auth',
  description: 'Retrieve bank account and routing numbers for ACH transfers',
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
   * Retrieves ACH/EFT routing and account numbers
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

      // Get auth info using SDK
      const response = await plaidClient.authGet(request)
      const data = response.data

      return {
        success: true,
        output: {
          accounts: data.accounts,
          numbers: data.numbers,
          metadata: {
            count: data.accounts.length,
          },
        },
      }
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: 'PLAID_AUTH_ERROR',
          message: error.message || 'Failed to retrieve auth information from Plaid',
          details: error.response?.data || error,
        },
      }
    }
  },

  outputs: {
    accounts: {
      type: 'json',
      description: 'Array of account objects',
    },
    numbers: {
      type: 'json',
      description: 'Bank account and routing numbers for ACH, EFT, etc.',
    },
    metadata: {
      type: 'json',
      description: 'Auth data metadata',
    },
  },
}
