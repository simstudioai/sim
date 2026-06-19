import { ErrorExtractorId } from '@/tools/error-extractors'
import type { GetRefundParams, RefundResponse } from '@/tools/square/types'
import {
  REFUND_METADATA_OUTPUT_PROPERTIES,
  REFUND_OUTPUT,
  SQUARE_BASE_URL,
  squareHeaders,
} from '@/tools/square/types'
import type { ToolConfig } from '@/tools/types'

export const squareGetRefundTool: ToolConfig<GetRefundParams, RefundResponse> = {
  id: 'square_get_refund',
  name: 'Square Get Refund',
  description: 'Retrieve a single payment refund by its ID',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.SQUARE_ERRORS,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Square access token (personal access token)',
    },
    refundId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the refund to retrieve',
    },
  },

  request: {
    url: (params) => `${SQUARE_BASE_URL}/v2/refunds/${encodeURIComponent(params.refundId)}`,
    method: 'GET',
    headers: (params) => squareHeaders(params.apiKey),
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
    refund: { ...REFUND_OUTPUT, description: 'The retrieved refund object' },
    metadata: {
      type: 'json',
      description: 'Refund summary metadata',
      properties: REFUND_METADATA_OUTPUT_PROPERTIES,
    },
  },
}
