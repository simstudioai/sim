import type { BrexListCashStatementsParams, BrexListStatementsResponse } from '@/tools/brex/types'
import { BREX_MONEY_PROPERTIES } from '@/tools/brex/types'
import {
  appendBrexPagination,
  BREX_API_BASE,
  buildBrexHeaders,
  parseBrexJson,
} from '@/tools/brex/utils'
import type { ToolConfig } from '@/tools/types'

export const brexListCashStatementsTool: ToolConfig<
  BrexListCashStatementsParams,
  BrexListStatementsResponse
> = {
  id: 'brex_list_cash_statements',
  name: 'Brex List Cash Statements',
  description: 'List finalized statements for a Brex cash account',
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
      description: 'ID of the cash account to list statements for',
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
      description: 'Number of statements to return (default 100, max 1000)',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      appendBrexPagination(query, params)
      const queryString = query.toString()
      const base = `${BREX_API_BASE}/v2/accounts/cash/${encodeURIComponent(params.accountId.trim())}/statements`
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
      description: 'Finalized cash account statements',
      items: {
        type: 'json',
        properties: {
          id: { type: 'string', description: 'Unique statement ID' },
          start_balance: {
            type: 'json',
            description: 'Balance at the start of the period',
            optional: true,
            properties: BREX_MONEY_PROPERTIES,
          },
          end_balance: {
            type: 'json',
            description: 'Balance at the end of the period',
            optional: true,
            properties: BREX_MONEY_PROPERTIES,
          },
          period: { type: 'json', description: 'Statement period (start_date, end_date)' },
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
