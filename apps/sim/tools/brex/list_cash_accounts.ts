import type { BrexListCashAccountsResponse, BrexPaginationParams } from '@/tools/brex/types'
import { BREX_MONEY_PROPERTIES } from '@/tools/brex/types'
import {
  appendBrexPagination,
  BREX_API_BASE,
  buildBrexHeaders,
  parseBrexJson,
} from '@/tools/brex/utils'
import type { ToolConfig } from '@/tools/types'

export const brexListCashAccountsTool: ToolConfig<
  BrexPaginationParams,
  BrexListCashAccountsResponse
> = {
  id: 'brex_list_cash_accounts',
  name: 'Brex List Cash Accounts',
  description: 'List all Brex cash accounts with balances and account details',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Brex user token (generated from Developer Settings in the Brex dashboard)',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from a previous response',
    },
    limit: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of accounts to return (default 100, max 1000)',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      appendBrexPagination(query, params)
      const queryString = query.toString()
      return queryString
        ? `${BREX_API_BASE}/v2/accounts/cash?${queryString}`
        : `${BREX_API_BASE}/v2/accounts/cash`
    },
    method: 'GET',
    headers: (params) => buildBrexHeaders(params.apiKey),
  },

  transformResponse: async (response) => {
    const data = await parseBrexJson(response)
    return {
      success: true,
      output: {
        items: data.items ?? [],
        nextCursor: data.next_cursor ?? null,
      },
    }
  },

  outputs: {
    items: {
      type: 'array',
      description: 'Cash accounts',
      items: {
        type: 'json',
        properties: {
          id: { type: 'string', description: 'Unique account ID' },
          name: { type: 'string', description: 'Account name' },
          status: { type: 'string', description: 'Account status', optional: true },
          current_balance: {
            type: 'json',
            description: 'Current balance',
            properties: BREX_MONEY_PROPERTIES,
          },
          available_balance: {
            type: 'json',
            description: 'Available balance',
            properties: BREX_MONEY_PROPERTIES,
          },
          account_number: { type: 'string', description: 'Bank account number' },
          routing_number: { type: 'string', description: 'Bank routing number' },
          primary: { type: 'boolean', description: 'Whether this is the primary cash account' },
        },
      },
    },
    nextCursor: {
      type: 'string',
      description: 'Cursor for fetching the next page of results',
      optional: true,
    },
  },
}
