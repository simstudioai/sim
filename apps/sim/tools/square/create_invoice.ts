import { generateId } from '@sim/utils/id'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { CreateInvoiceParams, InvoiceResponse } from '@/tools/square/types'
import {
  INVOICE_METADATA_OUTPUT_PROPERTIES,
  INVOICE_OUTPUT,
  SQUARE_BASE_URL,
  squareHeaders,
} from '@/tools/square/types'
import type { ToolConfig } from '@/tools/types'

export const squareCreateInvoiceTool: ToolConfig<CreateInvoiceParams, InvoiceResponse> = {
  id: 'square_create_invoice',
  name: 'Square Create Invoice',
  description: 'Create a draft invoice for an existing order and customer',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.SQUARE_ERRORS,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Square access token (personal access token)',
    },
    invoice: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Square invoice object including location_id, order_id, primary_recipient, and payment_requests (e.g. {"location_id":"L1","order_id":"O1","primary_recipient":{"customer_id":"C1"},"payment_requests":[{"request_type":"BALANCE","due_date":"2026-07-01"}]})',
    },
    idempotencyKey: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Unique key to make the request idempotent (auto-generated if omitted)',
    },
  },

  request: {
    url: () => `${SQUARE_BASE_URL}/v2/invoices`,
    method: 'POST',
    headers: (params) => squareHeaders(params.apiKey),
    body: (params) => ({
      idempotency_key: params.idempotencyKey || generateId(),
      invoice: params.invoice,
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
    invoice: { ...INVOICE_OUTPUT, description: 'The created invoice object' },
    metadata: {
      type: 'json',
      description: 'Invoice summary metadata',
      properties: INVOICE_METADATA_OUTPUT_PROPERTIES,
    },
  },
}
