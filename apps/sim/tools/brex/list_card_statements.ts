import type { BrexListStatementsResponse, BrexPaginationParams } from '@/tools/brex/types'
import { BREX_MONEY_PROPERTIES } from '@/tools/brex/types'
import {
  appendBrexPagination,
  BREX_API_BASE,
  buildBrexHeaders,
  parseBrexJson,
} from '@/tools/brex/utils'
import type { ToolConfig } from '@/tools/types'

export const brexListCardStatementsTool: ToolConfig<
  BrexPaginationParams,
  BrexListStatementsResponse
> = {
  id: 'brex_list_card_statements',
  name: 'Brex List Card Statements',
  description: 'List finalized statements for the primary Brex card account',
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
      description: 'Number of statements to return (default 100, max 1000)',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      appendBrexPagination(query, params)
      const queryString = query.toString()
      return queryString
        ? `${BREX_API_BASE}/v2/accounts/card/primary/statements?${queryString}`
        : `${BREX_API_BASE}/v2/accounts/card/primary/statements`
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
      description: 'Finalized card account statements',
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
