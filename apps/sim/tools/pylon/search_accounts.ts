import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import { buildPylonUrl, handlePylonError } from './types'

const logger = createLogger('PylonSearchAccounts')

export interface PylonSearchAccountsParams {
  apiToken: string
  filter: string
  limit?: string
  cursor?: string
}

export interface PylonSearchAccountsResponse {
  success: boolean
  output: {
    accounts: any[]
    pagination?: {
      cursor?: string
      has_next_page?: boolean
    }
    metadata: {
      operation: 'search_accounts'
      totalReturned: number
    }
    success: boolean
  }
}

export const pylonSearchAccountsTool: ToolConfig<
  PylonSearchAccountsParams,
  PylonSearchAccountsResponse
> = {
  id: 'pylon_search_accounts',
  name: 'Search Accounts in Pylon',
  description: 'Search accounts with custom filters',
  version: '1.0.0',

  params: {
    apiToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Pylon API token',
    },
    filter: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Filter as JSON string with field/operator/value structure',
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
    url: () => buildPylonUrl('/accounts/search'),
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: any = {}

      try {
        body.filter = JSON.parse(params.filter)
      } catch (error) {
        logger.warn('Failed to parse filter', { error })
        throw new Error('Invalid filter JSON format')
      }

      if (params.limit) {
        body.limit = Number.parseInt(params.limit, 10)
      }

      if (params.cursor) {
        body.cursor = params.cursor
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handlePylonError(data, response.status, 'search_accounts')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        accounts: data.data || [],
        pagination: data.pagination,
        metadata: {
          operation: 'search_accounts' as const,
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
      description: 'Search results',
      properties: {
        accounts: { type: 'array', description: 'Array of matching account objects' },
        pagination: { type: 'object', description: 'Pagination metadata' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
