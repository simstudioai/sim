import {
  INVOICE_PAYMENT_OUTPUT_PROPERTIES,
  mapInvoicePayment,
  mapPagination,
  PAGINATION_OUTPUT_PROPERTIES,
  ROCKETLANE_API_BASE,
  type RocketlaneInvoicePaymentListResponse,
  type RocketlaneInvoicePaymentsParams,
  rocketlaneError,
  rocketlaneHeaders,
} from '@/tools/rocketlane/types'
import type { ToolConfig } from '@/tools/types'

export const rocketlaneGetInvoicePaymentsTool: ToolConfig<
  RocketlaneInvoicePaymentsParams,
  RocketlaneInvoicePaymentListResponse
> = {
  id: 'rocketlane_get_invoice_payments',
  name: 'Rocketlane Get Invoice Payments',
  description: 'List payments recorded against a Rocketlane invoice',
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
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of payments per page (defaults to 100)',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page token from a previous response (valid for 15 minutes)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(
        `${ROCKETLANE_API_BASE}/invoices/${encodeURIComponent(params.invoiceId)}/payments`
      )
      if (params.pageSize != null) url.searchParams.set('pageSize', String(params.pageSize))
      if (params.pageToken) url.searchParams.set('pageToken', params.pageToken)
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
    const payments = Array.isArray(data?.data) ? data.data : []
    return {
      success: true,
      output: {
        payments: payments.map(mapInvoicePayment),
        pagination: mapPagination(data?.pagination),
      },
    }
  },

  outputs: {
    payments: {
      type: 'array',
      description: 'List of payments recorded against the invoice',
      items: { type: 'object', properties: INVOICE_PAYMENT_OUTPUT_PROPERTIES },
    },
    pagination: {
      type: 'object',
      description: 'Pagination details for the result set',
      properties: PAGINATION_OUTPUT_PROPERTIES,
    },
  },
}
