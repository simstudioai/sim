import type { BrexListVendorsResponse, BrexNameFilterParams } from '@/tools/brex/types'
import {
  appendBrexPagination,
  BREX_API_BASE,
  buildBrexHeaders,
  parseBrexJson,
} from '@/tools/brex/utils'
import type { ToolConfig } from '@/tools/types'

export const brexListVendorsTool: ToolConfig<BrexNameFilterParams, BrexListVendorsResponse> = {
  id: 'brex_list_vendors',
  name: 'Brex List Vendors',
  description: 'List vendors in the Brex account, optionally filtered by name',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Brex user token (generated from Developer Settings in the Brex dashboard)',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter vendors by name',
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
      description: 'Number of vendors to return (default 100, max 1000)',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      if (params.name) query.append('name', params.name.trim())
      appendBrexPagination(query, params)
      const queryString = query.toString()
      return queryString
        ? `${BREX_API_BASE}/v1/vendors?${queryString}`
        : `${BREX_API_BASE}/v1/vendors`
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
      description: 'Vendors in the Brex account',
      items: {
        type: 'json',
        properties: {
          id: { type: 'string', description: 'Unique vendor ID' },
          company_name: { type: 'string', description: 'Vendor company name', optional: true },
          email: { type: 'string', description: 'Vendor email address', optional: true },
          phone: { type: 'string', description: 'Vendor phone number', optional: true },
          payment_accounts: {
            type: 'array',
            description: 'Payment accounts associated with the vendor',
            optional: true,
          },
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
