import type { RampListReceiptsParams, RampListReceiptsResponse } from '@/tools/ramp/types'
import {
  buildRampHeaders,
  buildRampUrl,
  extractNextStart,
  extractRampError,
} from '@/tools/ramp/utils'
import type { ToolConfig } from '@/tools/types'

export const rampListReceiptsTool: ToolConfig<RampListReceiptsParams, RampListReceiptsResponse> = {
  id: 'ramp_list_receipts',
  name: 'Ramp List Receipts',
  description: 'List receipts in Ramp with optional filters',
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
    transactionId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter receipts by transaction ID',
    },
    fromDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Only include receipts for transactions that occurred after this ISO 8601 timestamp',
    },
    toDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Only include receipts for transactions that occurred before this ISO 8601 timestamp',
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
      buildRampUrl('/receipts', {
        transaction_id: params.transactionId,
        from_date: params.fromDate,
        to_date: params.toDate,
        page_size: params.pageSize,
        start: params.start,
      }),
    method: 'GET',
    headers: (params) => buildRampHeaders(params),
  },

  transformResponse: async (response): Promise<RampListReceiptsResponse> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: extractRampError(data, 'Failed to list Ramp receipts'),
        output: {},
      }
    }

    return {
      success: true,
      output: {
        receipts: data.data ?? [],
        nextStart: extractNextStart(data.page?.next),
      },
    }
  },

  outputs: {
    receipts: {
      type: 'array',
      description: 'List of Ramp receipts',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique identifier for the receipt' },
          receipt_url: {
            type: 'string',
            description: 'Pre-signed URL to download the receipt image (valid for one hour)',
          },
          transaction_id: { type: 'string', description: 'Transaction the receipt is attached to' },
          user_id: { type: 'string', description: 'User who uploaded the receipt' },
          created_at: { type: 'string', description: 'When the receipt was created' },
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
