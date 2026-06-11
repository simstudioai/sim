import type {
  RampListReimbursementsParams,
  RampListReimbursementsResponse,
} from '@/tools/ramp/types'
import {
  buildRampHeaders,
  buildRampUrl,
  extractNextStart,
  extractRampError,
} from '@/tools/ramp/utils'
import type { ToolConfig } from '@/tools/types'

export const rampListReimbursementsTool: ToolConfig<
  RampListReimbursementsParams,
  RampListReimbursementsResponse
> = {
  id: 'ramp_list_reimbursements',
  name: 'Ramp List Reimbursements',
  description: 'List reimbursements in Ramp with optional filters',
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
      description: 'Filter reimbursements by user ID',
    },
    fromDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include reimbursements created after this ISO 8601 timestamp',
    },
    toDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include reimbursements created before this ISO 8601 timestamp',
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
      buildRampUrl('/reimbursements', {
        user_id: params.userId,
        from_date: params.fromDate,
        to_date: params.toDate,
        page_size: params.pageSize,
        start: params.start,
      }),
    method: 'GET',
    headers: (params) => buildRampHeaders(params),
  },

  transformResponse: async (response): Promise<RampListReimbursementsResponse> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: extractRampError(data, 'Failed to list Ramp reimbursements'),
        output: {},
      }
    }

    return {
      success: true,
      output: {
        reimbursements: data.data ?? [],
        nextStart: extractNextStart(data.page?.next),
      },
    }
  },

  outputs: {
    reimbursements: {
      type: 'array',
      description: 'List of Ramp reimbursements',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique identifier for the reimbursement' },
          amount: { type: 'number', description: 'Reimbursement amount' },
          currency: { type: 'string', description: 'ISO 4217 currency code' },
          merchant: { type: 'string', description: 'Merchant the expense was made at' },
          memo: { type: 'string', description: 'Memo attached to the reimbursement' },
          state: { type: 'string', description: 'State of the reimbursement (e.g. APPROVED)' },
          type: { type: 'string', description: 'Type of reimbursement' },
          user_id: { type: 'string', description: 'ID of the user being reimbursed' },
          user_full_name: { type: 'string', description: 'Full name of the user' },
          created_at: { type: 'string', description: 'When the reimbursement was created' },
          transaction_date: { type: 'string', description: 'Date of the underlying expense' },
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
