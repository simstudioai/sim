import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid'
import type { GetTransactionsParams, GetTransactionsResponse } from '@/tools/plaid/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Plaid Get Transactions Tool
 * Uses official plaid SDK for transaction retrieval
 */
export const plaidGetTransactionsTool: ToolConfig<GetTransactionsParams, GetTransactionsResponse> =
  {
    id: 'plaid_get_transactions',
    name: 'Plaid Get Transactions',
    description: 'Retrieve transactions from Plaid for a date range',
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
      startDate: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Start date in YYYY-MM-DD format (e.g., "2024-01-01")',
      },
      endDate: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'End date in YYYY-MM-DD format (e.g., "2024-12-31")',
      },
      accountIds: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description: 'Optional array of account IDs to filter',
      },
      count: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Number of transactions to retrieve (default: 100, max: 500)',
      },
      offset: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Offset for pagination (default: 0)',
      },
    },

    /**
     * SDK-based execution using plaid PlaidApi
     * Retrieves transactions with automatic pagination support
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
          start_date: params.startDate,
          end_date: params.endDate,
          options: {},
        }

        if (params.accountIds && params.accountIds.length > 0) {
          request.options.account_ids = params.accountIds
        }

        if (params.count !== undefined) {
          request.options.count = Math.min(params.count, 500)
        }

        if (params.offset !== undefined) {
          request.options.offset = params.offset
        }

        // Get transactions using SDK
        const response = await plaidClient.transactionsGet(request)
        const data = response.data

        return {
          success: true,
          output: {
            transactions: data.transactions,
            accounts: data.accounts,
            total_transactions: data.total_transactions,
            metadata: {
              count: data.transactions.length,
              total_transactions: data.total_transactions,
              startDate: params.startDate,
              endDate: params.endDate,
            },
          },
        }
      } catch (error: any) {
        return {
          success: false,
          error: {
            code: 'PLAID_TRANSACTIONS_ERROR',
            message: error.message || 'Failed to retrieve transactions from Plaid',
            details: error.response?.data || error,
          },
        }
      }
    },

    outputs: {
      transactions: {
        type: 'json',
        description: 'Array of Plaid transaction objects',
      },
      accounts: {
        type: 'json',
        description: 'Array of associated account objects',
      },
      total_transactions: {
        type: 'number',
        description: 'Total number of transactions available',
      },
      metadata: {
        type: 'json',
        description: 'Transaction query metadata',
      },
    },
  }
