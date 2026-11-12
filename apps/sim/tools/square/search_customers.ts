import { ErrorExtractorId } from '@/tools/error-extractors'
import { SQUARE_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { CustomerListResponse, SearchCustomersParams } from '@/tools/square/types'
import {
  CUSTOMER_OUTPUT,
  LIST_METADATA_OUTPUT_PROPERTIES,
  SQUARE_ENVIRONMENTS,
  squareHeaders,
} from '@/tools/square/types'
import type { ToolConfig } from '@/tools/types'

export const squareSearchCustomersTool: ToolConfig<SearchCustomersParams, CustomerListResponse> = {
  id: 'square_search_customers',
  name: 'Square Search Customers',
  description: 'Search customer profiles using filters such as email, phone, or creation date',
  version: '1.0.0',
  oauth: SQUARE_CREDENTIAL_OAUTH,
  errorExtractor: ErrorExtractorId.SQUARE_ERRORS,

  params: {
    environment: SQUARE_ENVIRONMENTS.param,
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Square access token (personal access token)',
    },
    query: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Square customer query object with optional filter and sort (e.g. {"filter":{"email_address":{"exact":"a@b.com"}}})',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results to return per page',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from a previous response',
    },
  },

  request: {
    url: (params) => `${SQUARE_ENVIRONMENTS.apiBase(params.environment)}/v2/customers/search`,
    method: 'POST',
    headers: (params) => squareHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.query) body.query = params.query
      if (params.limit !== undefined) body.limit = params.limit
      if (params.cursor) body.cursor = params.cursor
      return body
    },
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
      description: 'Array of matching customer objects',
      items: CUSTOMER_OUTPUT,
    },
    metadata: {
      type: 'json',
      description: 'List pagination metadata',
      properties: LIST_METADATA_OUTPUT_PROPERTIES,
    },
  },
}
