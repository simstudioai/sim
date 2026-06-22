import { ErrorExtractorId } from '@/tools/error-extractors'
import type { GetPaymentParams, PaymentResponse } from '@/tools/square/types'
import {
  PAYMENT_METADATA_OUTPUT_PROPERTIES,
  PAYMENT_OUTPUT,
  SQUARE_BASE_URL,
  squareHeaders,
} from '@/tools/square/types'
import type { ToolConfig } from '@/tools/types'

export const squareGetPaymentTool: ToolConfig<GetPaymentParams, PaymentResponse> = {
  id: 'square_get_payment',
  name: 'Square Get Payment',
  description: 'Retrieve details for a single payment by its ID',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.SQUARE_ERRORS,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Square access token (personal access token)',
    },
    paymentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the payment to retrieve',
    },
  },

  request: {
    url: (params) => `${SQUARE_BASE_URL}/v2/payments/${encodeURIComponent(params.paymentId)}`,
    method: 'GET',
    headers: (params) => squareHeaders(params.apiKey),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    const payment = data.payment ?? {}
    return {
      success: true,
      output: {
        payment,
        metadata: {
          id: payment.id,
          status: payment.status ?? null,
          order_id: payment.order_id ?? null,
        },
      },
    }
  },

  outputs: {
    payment: { ...PAYMENT_OUTPUT, description: 'The retrieved payment object' },
    metadata: {
      type: 'json',
      description: 'Payment summary metadata',
      properties: PAYMENT_METADATA_OUTPUT_PROPERTIES,
    },
  },
}
