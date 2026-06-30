import { ErrorExtractorId } from '@/tools/error-extractors'
import type { CancelInvoiceParams, InvoiceResponse } from '@/tools/square/types'
import {
  INVOICE_METADATA_OUTPUT_PROPERTIES,
  INVOICE_OUTPUT,
  SQUARE_BASE_URL,
  squareHeaders,
} from '@/tools/square/types'
import type { ToolConfig } from '@/tools/types'

export const squareCancelInvoiceTool: ToolConfig<CancelInvoiceParams, InvoiceResponse> = {
  id: 'square_cancel_invoice',
  name: 'Square Cancel Invoice',
  description: 'Cancel a published invoice that is unpaid or partially paid',
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
      description: 'ID of the invoice to cancel',
    },
    version: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Current version of the invoice',
    },
  },

  request: {
    url: (params) =>
      `${SQUARE_BASE_URL}/v2/invoices/${encodeURIComponent(params.invoiceId)}/cancel`,
    method: 'POST',
    headers: (params) => squareHeaders(params.apiKey),
    body: (params) => ({ version: params.version }),
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
    invoice: { ...INVOICE_OUTPUT, description: 'The canceled invoice object' },
    metadata: {
      type: 'json',
      description: 'Invoice summary metadata',
      properties: INVOICE_METADATA_OUTPUT_PROPERTIES,
    },
  },
}
