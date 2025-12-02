import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import { buildPylonUrl, handlePylonError } from './types'

const logger = createLogger('PylonListAccounts')

export interface PylonListAccountsParams {
  apiToken: string
  limit?: string
  cursor?: string
}

export interface PylonListAccountsResponse {
  success: boolean
  output: {
    accounts: any[]
    pagination?: {
      cursor?: string
      has_next_page?: boolean
    }
    metadata: {
      operation: 'list_accounts'
      totalReturned: number
    }
    success: boolean
  }
}

export const pylonListAccountsTool: ToolConfig<PylonListAccountsParams, PylonListAccountsResponse> =
  {
    id: 'pylon_list_accounts',
    name: 'List Accounts in Pylon',
    description: 'Retrieve a paginated list of accounts',
    version: '1.0.0',

    params: {
      apiToken: {
        type: 'string',
        required: true,
        visibility: 'hidden',
        description: 'Pylon API token',
      },
      limit: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'Number of accounts to return (1-1000, default 100)',
      },
      cursor: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'Pagination cursor for next page of results',
      },
    },

    request: {
      url: (params) => {
        const url = new URL(buildPylonUrl('/accounts'))
        if (params.limit) {
          url.searchParams.append('limit', params.limit)
        }
        if (params.cursor) {
          url.searchParams.append('cursor', params.cursor)
        }
        return url.toString()
      },
      method: 'GET',
      headers: (params) => ({
        Authorization: `Bearer ${params.apiToken}`,
      }),
    },

    transformResponse: async (response: Response) => {
      if (!response.ok) {
        const data = await response.json()
        handlePylonError(data, response.status, 'list_accounts')
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          accounts: data.data || [],
          pagination: data.pagination,
          metadata: {
            operation: 'list_accounts' as const,
            totalReturned: data.data?.length || 0,
          },
          success: true,
        },
      }
    },

    outputs: {
      success: { type: 'boolean', description: 'Operation success status' },
      output: {
        type: 'object',
        description: 'List of accounts',
        properties: {
          accounts: { type: 'array', description: 'Array of account objects' },
          pagination: { type: 'object', description: 'Pagination metadata' },
          metadata: { type: 'object', description: 'Operation metadata' },
          success: { type: 'boolean', description: 'Operation success' },
        },
      },
    },
  }
