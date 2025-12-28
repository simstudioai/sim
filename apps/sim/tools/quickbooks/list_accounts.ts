import QuickBooks from 'node-quickbooks'
import type { ListAccountsParams, ListAccountsResponse } from '@/tools/quickbooks/types'
import type { ToolConfig } from '@/tools/types'

export const quickbooksListAccountsTool: ToolConfig<ListAccountsParams, ListAccountsResponse> = {
  id: 'quickbooks_list_accounts',
  name: 'QuickBooks List Accounts',
  description: 'Query and list chart of accounts in QuickBooks Online',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'QuickBooks OAuth access token',
    },
    realmId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'QuickBooks company ID (realm ID)',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'SQL-like query string (e.g., "SELECT * FROM Account WHERE Active = true")',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results to return (default: 100)',
    },
  },

  directExecution: async (params) => {
    try {
      const qbo = new QuickBooks(
        '', '', params.apiKey, '', params.realmId, false, false, 70, '2.0', null
      )

      const query = params.query || 'SELECT * FROM Account'
      const accounts = await new Promise<any[]>((resolve, reject) => {
        qbo.findAccounts(query, (err: any, result: any) => {
          if (err) reject(err)
          else resolve(result.QueryResponse?.Account || [])
        })
      })

      return {
        success: true,
        output: {
          accounts,
          metadata: {
            count: accounts.length,
          },
        },
      }
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: 'QUICKBOOKS_LIST_ACCOUNTS_ERROR',
          message: error.message || 'Failed to list accounts',
          details: error,
        },
      }
    }
  },

  outputs: {
    accounts: {
      type: 'json',
      description: 'Array of QuickBooks account objects',
    },
    metadata: {
      type: 'json',
      description: 'Query metadata including count',
    },
  },
}
