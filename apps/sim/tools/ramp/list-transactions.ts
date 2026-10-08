import type { RampListTransactionsParams, RampListTransactionsResponse } from '@/tools/ramp/types'
import { RAMP_TRANSACTION_PROPERTIES } from '@/tools/ramp/types'
import {
  appendRampPagination,
  buildRampHeaders,
  getRampPagination,
  parseRampResponse,
  projectTransaction,
} from '@/tools/ramp/utils'
import type { ToolConfig } from '@/tools/types'

export const rampListTransactionsTool: ToolConfig<
  RampListTransactionsParams,
  RampListTransactionsResponse
> = {
  id: 'ramp_list_transactions',
  name: 'Ramp List Transactions',
  description: 'List transactions in one page in Ramp',
  version: '1.0.0',
  oauth: { required: true, provider: 'ramp' },
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Ramp OAuth access token',
    },
    user_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by user.',
    },
    department_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by department.',
    },
    from_date: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter for transactions with a `user_transaction_time` after the given date, in ISO8601 format.',
    },
    to_date: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter for transactions with a `user_transaction_time` before the given date, in ISO8601 format.',
    },
    state: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Filter by transaction state. If set to 'ALL', all transactions including 'DECLINED' will be listed.",
    },
    sync_status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter for transactions by sync status. If set, it supersedes sync_ready and has_no_sync_commits',
    },
    start: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Next cursor from the previous response',
    },
    page_size: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Results per page, from 2 to 100 (default 20)',
    },
  },
  request: {
    url: (params) => {
      const query = new URLSearchParams()
      appendRampPagination(query, params)
      if (params.user_id) query.set('user_id', params.user_id.trim())
      if (params.department_id) query.set('department_id', params.department_id.trim())
      if (params.from_date) query.set('from_date', params.from_date.trim())
      if (params.to_date) query.set('to_date', params.to_date.trim())
      if (params.state) query.set('state', params.state.trim())
      if (params.sync_status) query.set('sync_status', params.sync_status.trim())
      return `https://api.ramp.com/developer/v1/transactions?${query}`
    },
    method: 'GET',
    headers: (params) => buildRampHeaders(params.accessToken),
  },
  transformResponse: async (response) => {
    const data = await parseRampResponse(response)
    if (!Array.isArray(data.data)) throw new Error('Ramp returned an invalid list response')
    if (data.data.length > 100) throw new Error('Ramp returned more than 100 results in one page')
    return {
      success: true,
      output: { transactions: data.data.map(projectTransaction), ...getRampPagination(data) },
    }
  },
  outputs: {
    transactions: {
      type: 'array',
      description: 'One page of transactions',
      items: { type: 'object', properties: RAMP_TRANSACTION_PROPERTIES },
    },
    nextCursor: {
      type: 'string',
      description: 'Pass this cursor as start to fetch the next page',
      optional: true,
    },
    nextPageUrl: {
      type: 'string',
      description: 'Ramp URL for the next page, or null on the last page',
      optional: true,
    },
  },
}
