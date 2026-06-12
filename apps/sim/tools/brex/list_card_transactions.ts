import type {
  BrexListCardTransactionsParams,
  BrexListCardTransactionsResponse,
} from '@/tools/brex/types'
import { BREX_CARD_TRANSACTION_PROPERTIES } from '@/tools/brex/types'
import {
  appendBrexArrayParam,
  appendBrexPagination,
  BREX_API_BASE,
  buildBrexHeaders,
  parseBrexJson,
  toBrexDateTime,
} from '@/tools/brex/utils'
import type { ToolConfig } from '@/tools/types'

export const brexListCardTransactionsTool: ToolConfig<
  BrexListCardTransactionsParams,
  BrexListCardTransactionsResponse
> = {
  id: 'brex_list_card_transactions',
  name: 'Brex List Card Transactions',
  description: 'List settled card transactions for all Brex card accounts',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Brex user token (generated from Developer Settings in the Brex dashboard)',
    },
    userIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated user IDs to filter transactions by cardholder',
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
      query.append('expand[]', 'expense_id')
      appendBrexArrayParam(query, 'user_ids', params.userIds)
      if (params.postedAtStart)
        query.append('posted_at_start', toBrexDateTime(params.postedAtStart))
      appendBrexPagination(query, params)
      return `${BREX_API_BASE}/v2/transactions/card/primary?${query.toString()}`
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
      description: 'Settled card transactions',
      items: { type: 'json', properties: BREX_CARD_TRANSACTION_PROPERTIES },
    },
    nextCursor: {
      type: 'string',
      description: 'Cursor for fetching the next page of results',
      optional: true,
    },
  },
}
