import type { RampGetBillParams, RampGetBillResponse } from '@/tools/ramp/types'
import { buildRampHeaders, buildRampUrl, extractRampError } from '@/tools/ramp/utils'
import type { ToolConfig } from '@/tools/types'

export const rampGetBillTool: ToolConfig<RampGetBillParams, RampGetBillResponse> = {
  id: 'ramp_get_bill',
  name: 'Ramp Get Bill',
  description: 'Retrieve a single Ramp bill by ID',
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
    billId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the bill to retrieve',
    },
  },

  request: {
    url: (params) => buildRampUrl(`/bills/${encodeURIComponent(params.billId.trim())}`),
    method: 'GET',
    headers: (params) => buildRampHeaders(params),
  },

  transformResponse: async (response): Promise<RampGetBillResponse> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: extractRampError(data, 'Failed to get Ramp bill'),
        output: {},
      }
    }

    return {
      success: true,
      output: {
        bill: data,
      },
    }
  },

  outputs: {
    bill: {
      type: 'object',
      description: 'The requested Ramp bill',
      properties: {
        id: { type: 'string', description: 'Unique identifier for the bill' },
        invoice_number: { type: 'string', description: 'Invoice number of the bill' },
        amount: {
          type: 'object',
          description:
            'Canonical bill amount (integer amount in the smallest currency denomination plus currency code)',
        },
        status: { type: 'string', description: 'Status of the bill (e.g. OPEN, PAID)' },
        due_at: { type: 'string', description: 'When the bill is due' },
        issued_at: { type: 'string', description: 'When the bill was issued' },
        vendor: { type: 'object', description: 'Vendor the bill is payable to' },
        memo: { type: 'string', description: 'Memo attached to the bill' },
        line_items: { type: 'array', description: 'Line items on the bill' },
      },
    },
  },
}
