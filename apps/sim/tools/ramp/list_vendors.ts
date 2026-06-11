import type { RampListVendorsParams, RampListVendorsResponse } from '@/tools/ramp/types'
import {
  buildRampHeaders,
  buildRampUrl,
  extractNextStart,
  extractRampError,
} from '@/tools/ramp/utils'
import type { ToolConfig } from '@/tools/types'

export const rampListVendorsTool: ToolConfig<RampListVendorsParams, RampListVendorsResponse> = {
  id: 'ramp_list_vendors',
  name: 'Ramp List Vendors',
  description: 'List vendors in Ramp with optional filters',
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
    vendorName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter vendors by name',
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
      buildRampUrl('/vendors', {
        name: params.vendorName,
        page_size: params.pageSize,
        start: params.start,
      }),
    method: 'GET',
    headers: (params) => buildRampHeaders(params),
  },

  transformResponse: async (response): Promise<RampListVendorsResponse> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: extractRampError(data, 'Failed to list Ramp vendors'),
        output: {},
      }
    }

    return {
      success: true,
      output: {
        vendors: data.data ?? [],
        nextStart: extractNextStart(data.page?.next),
      },
    }
  },

  outputs: {
    vendors: {
      type: 'array',
      description: 'List of Ramp vendors',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique identifier for the vendor' },
          name: { type: 'string', description: 'Name of the vendor' },
          state: { type: 'string', description: 'State of the vendor record' },
          is_active: { type: 'boolean', description: 'Whether the vendor is active' },
          country: { type: 'string', description: 'Country of the vendor' },
          total_spend_ytd: {
            type: 'object',
            description:
              'Year-to-date spend with the vendor (integer amount in the smallest currency denomination plus currency code)',
          },
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
