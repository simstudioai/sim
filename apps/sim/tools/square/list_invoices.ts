import { ErrorExtractorId } from '@/tools/error-extractors'
import type { InvoiceListResponse, ListInvoicesParams } from '@/tools/square/types'
import {
  INVOICE_OUTPUT,
  LIST_METADATA_OUTPUT_PROPERTIES,
  SQUARE_BASE_URL,
  squareHeaders,
} from '@/tools/square/types'
import type { ToolConfig } from '@/tools/types'

export const squareListInvoicesTool: ToolConfig<ListInvoicesParams, InvoiceListResponse> = {
  id: 'square_list_invoices',
  name: 'Square List Invoices',
  description: 'List invoices for a specific location',
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
      description: 'ID of the location to list invoices for',
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
    url: (params) => {
      const url = new URL(`${SQUARE_BASE_URL}/v2/invoices`)
      url.searchParams.append('location_id', params.locationId)
      if (params.limit !== undefined) url.searchParams.append('limit', params.limit.toString())
      if (params.cursor) url.searchParams.append('cursor', params.cursor)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => squareHeaders(params.apiKey),
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
      description: 'Array of invoice objects',
      items: INVOICE_OUTPUT,
    },
    metadata: {
      type: 'json',
      description: 'List pagination metadata',
      properties: LIST_METADATA_OUTPUT_PROPERTIES,
    },
  },
}
