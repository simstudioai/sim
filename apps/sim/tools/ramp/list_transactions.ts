import type { RampListTransactionsParams, RampListTransactionsResponse } from '@/tools/ramp/types'
import {
  buildRampHeaders,
  buildRampUrl,
  extractNextStart,
  extractRampError,
} from '@/tools/ramp/utils'
import type { ToolConfig } from '@/tools/types'

export const rampListTransactionsTool: ToolConfig<
  RampListTransactionsParams,
  RampListTransactionsResponse
> = {
  id: 'ramp_list_transactions',
  name: 'Ramp List Transactions',
  description: 'List card transactions in Ramp with optional filters',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'ramp',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for the Ramp API',
    },
    userId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter transactions by user ID',
    },
    cardId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter transactions by card ID',
    },
    departmentId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter transactions by department ID',
    },
    merchantId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter transactions by merchant ID',
    },
    state: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter by transaction state: ALL, CLEARED, COMPLETION, DECLINED, ERROR, PENDING, or PENDING_INITIATION. Declined transactions are only included when set to ALL or DECLINED.',
    },
    minAmount: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include transactions larger than this U.S. dollar amount',
    },
    maxAmount: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include transactions smaller than this U.S. dollar amount',
    },
    fromDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include transactions that occurred after this ISO 8601 timestamp',
    },
    toDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include transactions that occurred before this ISO 8601 timestamp',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per page (between 2 and 100, default 20)',
    },
    start: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor: the ID of the last entity from the previous page',
    },
  },

  request: {
    url: (params) =>
      buildRampUrl('/transactions', {
        user_id: params.userId,
        card_id: params.cardId,
        department_id: params.departmentId,
        merchant_id: params.merchantId,
        state: params.state,
        min_amount: params.minAmount,
        max_amount: params.maxAmount,
        from_date: params.fromDate,
        to_date: params.toDate,
        page_size: params.pageSize,
        start: params.start,
      }),
    method: 'GET',
    headers: (params) => buildRampHeaders(params),
  },

  transformResponse: async (response): Promise<RampListTransactionsResponse> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: extractRampError(data, 'Failed to list Ramp transactions'),
        output: {},
      }
    }

    return {
      success: true,
      output: {
        transactions: data.data ?? [],
        nextStart: extractNextStart(data.page?.next),
      },
    }
  },

  outputs: {
    transactions: {
      type: 'array',
      description: 'List of Ramp card transactions',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique identifier for the transaction' },
          amount: { type: 'number', description: 'Settled amount in U.S. dollars' },
          currency_code: { type: 'string', description: 'ISO 4217 currency code' },
          merchant_name: { type: 'string', description: 'Name of the merchant' },
          memo: { type: 'string', description: 'Memo attached to the transaction' },
          state: { type: 'string', description: 'Transaction state (e.g. CLEARED, PENDING)' },
          user_transaction_time: { type: 'string', description: 'When the transaction occurred' },
          card_id: { type: 'string', description: 'ID of the card used' },
          card_holder: { type: 'object', description: 'Cardholder details (user and department)' },
          receipts: { type: 'array', description: 'IDs of receipts attached to the transaction' },
        },
      },
    },
    nextStart: {
      type: 'string',
      description: 'Cursor for the next page of results (null when there are no more pages)',
      optional: true,
    },
  },
}
