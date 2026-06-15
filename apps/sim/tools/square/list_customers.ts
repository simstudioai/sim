import { ErrorExtractorId } from '@/tools/error-extractors'
import type { CustomerListResponse, ListCustomersParams } from '@/tools/square/types'
import {
  CUSTOMER_OUTPUT,
  LIST_METADATA_OUTPUT_PROPERTIES,
  SQUARE_BASE_URL,
  squareHeaders,
} from '@/tools/square/types'
import type { ToolConfig } from '@/tools/types'

export const squareListCustomersTool: ToolConfig<ListCustomersParams, CustomerListResponse> = {
  id: 'square_list_customers',
  name: 'Square List Customers',
  description: 'List customer profiles in the Square customer directory',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.SQUARE_ERRORS,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Square access token (personal access token)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results to return per page (max 100)',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from a previous response',
    },
    sortField: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Field to sort by (DEFAULT or CREATED_AT)',
    },
    sortOrder: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort order (ASC or DESC)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`${SQUARE_BASE_URL}/v2/customers`)
      if (params.limit !== undefined) url.searchParams.append('limit', params.limit.toString())
      if (params.cursor) url.searchParams.append('cursor', params.cursor)
      if (params.sortField) url.searchParams.append('sort_field', params.sortField)
      if (params.sortOrder) url.searchParams.append('sort_order', params.sortOrder)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => squareHeaders(params.apiKey),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    const customers = data.customers ?? []
    return {
      success: true,
      output: {
        customers,
        metadata: {
          count: customers.length,
          cursor: data.cursor ?? null,
        },
      },
    }
  },

  outputs: {
    customers: {
      type: 'array',
      description: 'Array of customer objects',
      items: CUSTOMER_OUTPUT,
    },
    metadata: {
      type: 'json',
      description: 'List pagination metadata',
      properties: LIST_METADATA_OUTPUT_PROPERTIES,
    },
  },
}
