import {
  INVOICE_OUTPUT_PROPERTIES,
  mapInvoice,
  ROCKETLANE_API_BASE,
  type RocketlaneInvoiceGetParams,
  type RocketlaneInvoiceResponse,
  rocketlaneError,
  rocketlaneHeaders,
} from '@/tools/rocketlane/types'
import type { ToolConfig } from '@/tools/types'

export const rocketlaneGetInvoiceTool: ToolConfig<
  RocketlaneInvoiceGetParams,
  RocketlaneInvoiceResponse
> = {
  id: 'rocketlane_get_invoice',
  name: 'Rocketlane Get Invoice',
  description: 'Retrieve a Rocketlane invoice by its ID',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rocketlane API key',
    },
    invoiceId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique identifier of the invoice',
    },
    includeFields: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional fields to include in the response: notes, attachments',
      items: { type: 'string' },
    },
    includeAllFields: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return all fields in the response',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`${ROCKETLANE_API_BASE}/invoices/${encodeURIComponent(params.invoiceId)}`)
      if (params.includeFields?.length) {
        url.searchParams.set('includeFields', params.includeFields.join(','))
      }
      if (params.includeAllFields != null) {
        url.searchParams.set('includeAllFields', String(params.includeAllFields))
      }
      return url.toString()
    },
    method: 'GET',
    headers: (params) => rocketlaneHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      throw new Error(await rocketlaneError(response))
    }
    const data = await response.json()
    return {
      success: true,
      output: { invoice: mapInvoice(data) },
    }
  },

  outputs: {
    invoice: {
      type: 'object',
      description: 'The requested invoice',
      properties: INVOICE_OUTPUT_PROPERTIES,
    },
  },
}
