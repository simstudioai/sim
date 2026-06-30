import { generateId } from '@sim/utils/id'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { InvoiceResponse, PublishInvoiceParams } from '@/tools/square/types'
import {
  INVOICE_METADATA_OUTPUT_PROPERTIES,
  INVOICE_OUTPUT,
  SQUARE_BASE_URL,
  squareHeaders,
} from '@/tools/square/types'
import type { ToolConfig } from '@/tools/types'

export const squarePublishInvoiceTool: ToolConfig<PublishInvoiceParams, InvoiceResponse> = {
  id: 'square_publish_invoice',
  name: 'Square Publish Invoice',
  description: 'Publish a draft invoice so it is sent to the customer and becomes payable',
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
      description: 'ID of the invoice to publish',
    },
    version: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Current version of the invoice (use the version returned by Create Invoice)',
    },
    idempotencyKey: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Unique key to make the request idempotent (auto-generated if omitted)',
    },
  },

  request: {
    url: (params) =>
      `${SQUARE_BASE_URL}/v2/invoices/${encodeURIComponent(params.invoiceId)}/publish`,
    method: 'POST',
    headers: (params) => squareHeaders(params.apiKey),
    body: (params) => ({
      version: params.version,
      idempotency_key: params.idempotencyKey || generateId(),
    }),
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
    invoice: { ...INVOICE_OUTPUT, description: 'The published invoice object' },
    metadata: {
      type: 'json',
      description: 'Invoice summary metadata',
      properties: INVOICE_METADATA_OUTPUT_PROPERTIES,
    },
  },
}
