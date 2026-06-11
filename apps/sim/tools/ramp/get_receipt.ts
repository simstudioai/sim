import type { RampGetReceiptParams, RampGetReceiptResponse } from '@/tools/ramp/types'
import { buildRampHeaders, buildRampUrl, extractRampError } from '@/tools/ramp/utils'
import type { ToolConfig } from '@/tools/types'

export const rampGetReceiptTool: ToolConfig<RampGetReceiptParams, RampGetReceiptResponse> = {
  id: 'ramp_get_receipt',
  name: 'Ramp Get Receipt',
  description: 'Retrieve a single Ramp receipt by ID',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'ramp',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for the Ramp API',
    },
    receiptId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the receipt to retrieve',
    },
  },

  request: {
    url: (params) => buildRampUrl(`/receipts/${encodeURIComponent(params.receiptId.trim())}`),
    method: 'GET',
    headers: (params) => buildRampHeaders(params),
  },

  transformResponse: async (response): Promise<RampGetReceiptResponse> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: extractRampError(data, 'Failed to get Ramp receipt'),
        output: {},
      }
    }

    return {
      success: true,
      output: {
        receipt: data,
      },
    }
  },

  outputs: {
    receipt: {
      type: 'object',
      description: 'The requested Ramp receipt',
      properties: {
        id: { type: 'string', description: 'Unique identifier for the receipt' },
        receipt_url: {
          type: 'string',
          description: 'Pre-signed URL to download the receipt image (valid for one hour)',
        },
        transaction_id: { type: 'string', description: 'Transaction the receipt is attached to' },
        user_id: { type: 'string', description: 'User who uploaded the receipt' },
        created_at: { type: 'string', description: 'When the receipt was created' },
      },
    },
  },
}
