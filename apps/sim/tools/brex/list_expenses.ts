import type { BrexListExpensesParams, BrexListExpensesResponse } from '@/tools/brex/types'
import { BREX_EXPENSE_ITEM_PROPERTIES } from '@/tools/brex/types'
import {
  appendBrexArrayParam,
  appendBrexPagination,
  BREX_API_BASE,
  buildBrexHeaders,
  parseBrexJson,
  toBrexDateTime,
} from '@/tools/brex/utils'
import type { ToolConfig } from '@/tools/types'

const EXPAND_FIELDS = [
  'merchant',
  'user',
  'budget',
  'department',
  'location',
  'receipts.download_uris',
]

export const brexListExpensesTool: ToolConfig<BrexListExpensesParams, BrexListExpensesResponse> = {
  id: 'brex_list_expenses',
  name: 'Brex List Expenses',
  description:
    'List expenses in the Brex account with optional filters for user, status, payment status, and purchase date range',
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
      description: 'Comma-separated user IDs to filter expenses by owner',
    },
    statuses: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated expense statuses to filter by: DRAFT, SUBMITTED, APPROVED, OUT_OF_POLICY, VOID, CANCELED, SPLIT, SETTLED',
    },
    paymentStatuses: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated payment statuses to filter by: NOT_STARTED, PROCESSING, CANCELED, DECLINED, CLEARED, REFUNDING, REFUNDED, CASH_ADVANCE, CREDITED, AWAITING_PAYMENT, SCHEDULED',
    },
    purchasedAtStart: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include expenses purchased at or after this ISO 8601 timestamp',
    },
    purchasedAtEnd: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include expenses purchased at or before this ISO 8601 timestamp',
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
      description: 'Number of expenses to return (max 100)',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      for (const field of EXPAND_FIELDS) {
        query.append('expand[]', field)
      }
      appendBrexArrayParam(query, 'user_id[]', params.userIds)
      appendBrexArrayParam(query, 'status[]', params.statuses)
      appendBrexArrayParam(query, 'payment_status[]', params.paymentStatuses)
      if (params.purchasedAtStart)
        query.append('purchased_at_start', toBrexDateTime(params.purchasedAtStart))
      if (params.purchasedAtEnd)
        query.append('purchased_at_end', toBrexDateTime(params.purchasedAtEnd))
      appendBrexPagination(query, params)
      return `${BREX_API_BASE}/v1/expenses?${query.toString()}`
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
      description: 'Expenses matching the filters',
      items: { type: 'json', properties: BREX_EXPENSE_ITEM_PROPERTIES },
    },
    nextCursor: {
      type: 'string',
      description: 'Cursor for fetching the next page of results',
      optional: true,
    },
  },
}
