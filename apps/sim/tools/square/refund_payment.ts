import { generateId } from '@sim/utils/id'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { RefundPaymentParams, RefundResponse } from '@/tools/square/types'
import {
  REFUND_METADATA_OUTPUT_PROPERTIES,
  REFUND_OUTPUT,
  SQUARE_BASE_URL,
  squareHeaders,
} from '@/tools/square/types'
import type { ToolConfig } from '@/tools/types'

export const squareRefundPaymentTool: ToolConfig<RefundPaymentParams, RefundResponse> = {
  id: 'square_refund_payment',
  name: 'Square Refund Payment',
  description: 'Refund all or part of a completed payment',
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
      description: 'ID of the payment to refund',
    },
    amount: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Amount to refund in the smallest currency denomination (e.g. 100 = $1.00)',
    },
    currency: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Three-letter ISO 4217 currency code (e.g. USD)',
    },
    idempotencyKey: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Unique key to make the request idempotent (auto-generated if omitted)',
    },
    reason: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Reason for the refund',
    },
  },

  request: {
    url: () => `${SQUARE_BASE_URL}/v2/refunds`,
    method: 'POST',
    headers: (params) => squareHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = {
        idempotency_key: params.idempotencyKey || generateId(),
        payment_id: params.paymentId,
        amount_money: { amount: params.amount, currency: params.currency },
      }
      if (params.reason) body.reason = params.reason
      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    const refund = data.refund ?? {}
    return {
      success: true,
      output: {
        refund,
        metadata: {
          id: refund.id,
          status: refund.status ?? null,
          payment_id: refund.payment_id ?? null,
        },
      },
    }
  },

  outputs: {
    refund: { ...REFUND_OUTPUT, description: 'The created refund object' },
    metadata: {
      type: 'json',
      description: 'Refund summary metadata',
      properties: REFUND_METADATA_OUTPUT_PROPERTIES,
    },
  },
}
