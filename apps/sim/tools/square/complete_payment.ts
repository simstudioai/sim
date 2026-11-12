import { ErrorExtractorId } from '@/tools/error-extractors'
import { SQUARE_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { CompletePaymentParams, PaymentResponse } from '@/tools/square/types'
import {
  PAYMENT_METADATA_OUTPUT_PROPERTIES,
  PAYMENT_OUTPUT,
  SQUARE_ENVIRONMENTS,
  squareHeaders,
} from '@/tools/square/types'
import type { ToolConfig } from '@/tools/types'

export const squareCompletePaymentTool: ToolConfig<CompletePaymentParams, PaymentResponse> = {
  id: 'square_complete_payment',
  name: 'Square Complete Payment',
  description: 'Capture (complete) a payment that was authorized with delayed capture',
  version: '1.0.0',
  oauth: SQUARE_CREDENTIAL_OAUTH,
  errorExtractor: ErrorExtractorId.SQUARE_ERRORS,

  params: {
    environment: SQUARE_ENVIRONMENTS.param,
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
      description: 'ID of the payment to complete',
    },
    versionToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional version token for optimistic concurrency control',
    },
  },

  request: {
    url: (params) =>
      `${SQUARE_ENVIRONMENTS.apiBase(params.environment)}/v2/payments/${encodeURIComponent(params.paymentId)}/complete`,
    method: 'POST',
    headers: (params) => squareHeaders(params.apiKey),
    body: (params) => (params.versionToken ? { version_token: params.versionToken } : {}),
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
    payment: { ...PAYMENT_OUTPUT, description: 'The completed payment object' },
    metadata: {
      type: 'json',
      description: 'Payment summary metadata',
      properties: PAYMENT_METADATA_OUTPUT_PROPERTIES,
    },
  },
}
