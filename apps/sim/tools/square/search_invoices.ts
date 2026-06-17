import { ErrorExtractorId } from '@/tools/error-extractors'
import type { InvoiceListResponse, SearchInvoicesParams } from '@/tools/square/types'
import {
  INVOICE_OUTPUT,
  LIST_METADATA_OUTPUT_PROPERTIES,
  SQUARE_BASE_URL,
  squareHeaders,
} from '@/tools/square/types'
import type { ToolConfig } from '@/tools/types'

export const squareSearchInvoicesTool: ToolConfig<SearchInvoicesParams, InvoiceListResponse> = {
  id: 'square_search_invoices',
  name: 'Square Search Invoices',
  description: 'Search invoices across one or more locations',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.SQUARE_ERRORS,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Square access token (personal access token)',
    },
    locationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the location to search within (Square allows one location per search)',
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
    url: () => `${SQUARE_BASE_URL}/v2/invoices/search`,
    method: 'POST',
    headers: (params) => squareHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = {
        query: {
          filter: { location_ids: [params.locationId] },
        },
      }
      if (params.limit !== undefined) body.limit = params.limit
      if (params.cursor) body.cursor = params.cursor
      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    const invoices = data.invoices ?? []
    return {
      success: true,
      output: {
        invoices,
        metadata: {
          count: invoices.length,
          cursor: data.cursor ?? null,
        },
      },
    }
  },

  outputs: {
    invoices: {
      type: 'array',
      description: 'Array of matching invoice objects',
      items: INVOICE_OUTPUT,
    },
    metadata: {
      type: 'json',
      description: 'List pagination metadata',
      properties: LIST_METADATA_OUTPUT_PROPERTIES,
    },
  },
}
