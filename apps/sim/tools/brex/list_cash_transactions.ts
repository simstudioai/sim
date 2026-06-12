import type {
  BrexListCashTransactionsParams,
  BrexListCashTransactionsResponse,
} from '@/tools/brex/types'
import { BREX_CASH_TRANSACTION_PROPERTIES } from '@/tools/brex/types'
import {
  appendBrexPagination,
  BREX_API_BASE,
  buildBrexHeaders,
  parseBrexJson,
  toBrexDateTime,
} from '@/tools/brex/utils'
import type { ToolConfig } from '@/tools/types'

export const brexListCashTransactionsTool: ToolConfig<
  BrexListCashTransactionsParams,
  BrexListCashTransactionsResponse
> = {
  id: 'brex_list_cash_transactions',
  name: 'Brex List Cash Transactions',
  description: 'List transactions for a Brex cash account',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Brex user token (generated from Developer Settings in the Brex dashboard)',
    },
    accountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the cash account to list transactions for',
    },
    postedAtStart: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include transactions posted at or after this ISO 8601 timestamp',
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
      description: 'Number of transactions to return (default 100, max 1000)',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      if (params.postedAtStart)
        query.append('posted_at_start', toBrexDateTime(params.postedAtStart))
      appendBrexPagination(query, params)
      const queryString = query.toString()
      const base = `${BREX_API_BASE}/v2/transactions/cash/${encodeURIComponent(params.accountId.trim())}`
      return queryString ? `${base}?${queryString}` : base
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
      description: 'Cash account transactions',
      items: { type: 'json', properties: BREX_CASH_TRANSACTION_PROPERTIES },
    },
    nextCursor: {
      type: 'string',
      description: 'Cursor for fetching the next page of results',
      optional: true,
    },
  },
}
