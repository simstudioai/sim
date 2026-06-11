import type { RampListBillsParams, RampListBillsResponse } from '@/tools/ramp/types'
import {
  buildRampHeaders,
  buildRampUrl,
  extractNextStart,
  extractRampError,
} from '@/tools/ramp/utils'
import type { ToolConfig } from '@/tools/types'

export const rampListBillsTool: ToolConfig<RampListBillsParams, RampListBillsResponse> = {
  id: 'ramp_list_bills',
  name: 'Ramp List Bills',
  description: 'List bills in Ramp with optional filters',
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
    vendorId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter bills by vendor ID',
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
      buildRampUrl('/bills', {
        vendor_id: params.vendorId,
        page_size: params.pageSize,
        start: params.start,
      }),
    method: 'GET',
    headers: (params) => buildRampHeaders(params),
  },

  transformResponse: async (response): Promise<RampListBillsResponse> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: extractRampError(data, 'Failed to list Ramp bills'),
        output: {},
      }
    }

    return {
      success: true,
      output: {
        bills: data.data ?? [],
        nextStart: extractNextStart(data.page?.next),
      },
    }
  },

  outputs: {
    bills: {
      type: 'array',
      description: 'List of Ramp bills',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique identifier for the bill' },
          invoice_number: { type: 'string', description: 'Invoice number of the bill' },
          amount: {
            type: 'object',
            description:
              'Canonical bill amount (integer amount in the smallest currency denomination plus currency code)',
          },
          status: { type: 'string', description: 'Status of the bill (e.g. OPEN, PAID)' },
          due_at: { type: 'string', description: 'When the bill is due' },
          issued_at: { type: 'string', description: 'When the bill was issued' },
          vendor: { type: 'object', description: 'Vendor the bill is payable to' },
          memo: { type: 'string', description: 'Memo attached to the bill' },
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
