import { ErrorExtractorId } from '@/tools/error-extractors'
import type { DeleteInvoiceParams, InvoiceDeleteResponse } from '@/tools/square/types'
import { SQUARE_BASE_URL, squareHeaders } from '@/tools/square/types'
import type { ToolConfig } from '@/tools/types'

export const squareDeleteInvoiceTool: ToolConfig<DeleteInvoiceParams, InvoiceDeleteResponse> = {
  id: 'square_delete_invoice',
  name: 'Square Delete Invoice',
  description: 'Delete a draft invoice',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.SQUARE_ERRORS,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Square access token (personal access token)',
    },
    invoiceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the draft invoice to delete',
    },
    version: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Current version of the invoice (required if the invoice has been updated)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`${SQUARE_BASE_URL}/v2/invoices/${encodeURIComponent(params.invoiceId)}`)
      if (params.version !== undefined)
        url.searchParams.append('version', params.version.toString())
      return url.toString()
    },
    method: 'DELETE',
    headers: (params) => squareHeaders(params.apiKey),
  },

  transformResponse: async (response, params) => {
    await response.json().catch(() => ({}))
    return {
      success: true,
      output: {
        deleted: true,
        id: params?.invoiceId ?? '',
      },
    }
  },

  outputs: {
    deleted: { type: 'boolean', description: 'Whether the invoice was deleted' },
    id: { type: 'string', description: 'ID of the deleted invoice' },
  },
}
