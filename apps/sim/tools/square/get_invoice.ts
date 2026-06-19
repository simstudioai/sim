import { ErrorExtractorId } from '@/tools/error-extractors'
import type { GetInvoiceParams, InvoiceResponse } from '@/tools/square/types'
import {
  INVOICE_METADATA_OUTPUT_PROPERTIES,
  INVOICE_OUTPUT,
  SQUARE_BASE_URL,
  squareHeaders,
} from '@/tools/square/types'
import type { ToolConfig } from '@/tools/types'

export const squareGetInvoiceTool: ToolConfig<GetInvoiceParams, InvoiceResponse> = {
  id: 'square_get_invoice',
  name: 'Square Get Invoice',
  description: 'Retrieve a single invoice by its ID',
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
      description: 'ID of the invoice to retrieve',
    },
  },

  request: {
    url: (params) => `${SQUARE_BASE_URL}/v2/invoices/${encodeURIComponent(params.invoiceId)}`,
    method: 'GET',
    headers: (params) => squareHeaders(params.apiKey),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    const invoice = data.invoice ?? {}
    return {
      success: true,
      output: {
        invoice,
        metadata: {
          id: invoice.id,
          status: invoice.status ?? null,
          version: invoice.version ?? null,
        },
      },
    }
  },

  outputs: {
    invoice: { ...INVOICE_OUTPUT, description: 'The retrieved invoice object' },
    metadata: {
      type: 'json',
      description: 'Invoice summary metadata',
      properties: INVOICE_METADATA_OUTPUT_PROPERTIES,
    },
  },
}
