import type { RampGetReimbursementParams, RampGetReimbursementResponse } from '@/tools/ramp/types'
import { buildRampHeaders, buildRampUrl, extractRampError } from '@/tools/ramp/utils'
import type { ToolConfig } from '@/tools/types'

export const rampGetReimbursementTool: ToolConfig<
  RampGetReimbursementParams,
  RampGetReimbursementResponse
> = {
  id: 'ramp_get_reimbursement',
  name: 'Ramp Get Reimbursement',
  description: 'Retrieve a single Ramp reimbursement by ID',
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
    reimbursementId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the reimbursement to retrieve',
    },
  },

  request: {
    url: (params) =>
      buildRampUrl(`/reimbursements/${encodeURIComponent(params.reimbursementId.trim())}`),
    method: 'GET',
    headers: (params) => buildRampHeaders(params),
  },

  transformResponse: async (response): Promise<RampGetReimbursementResponse> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: extractRampError(data, 'Failed to get Ramp reimbursement'),
        output: {},
      }
    }

    return {
      success: true,
      output: {
        reimbursement: data,
      },
    }
  },

  outputs: {
    reimbursement: {
      type: 'object',
      description: 'The requested Ramp reimbursement',
      properties: {
        id: { type: 'string', description: 'Unique identifier for the reimbursement' },
        amount: { type: 'number', description: 'Reimbursement amount' },
        currency: { type: 'string', description: 'ISO 4217 currency code' },
        merchant: { type: 'string', description: 'Merchant the expense was made at' },
        memo: { type: 'string', description: 'Memo attached to the reimbursement' },
        state: { type: 'string', description: 'State of the reimbursement (e.g. APPROVED)' },
        type: { type: 'string', description: 'Type of reimbursement' },
        user_id: { type: 'string', description: 'ID of the user being reimbursed' },
        user_full_name: { type: 'string', description: 'Full name of the user' },
        created_at: { type: 'string', description: 'When the reimbursement was created' },
        transaction_date: { type: 'string', description: 'Date of the underlying expense' },
        receipts: { type: 'array', description: 'IDs of receipts attached to the reimbursement' },
      },
    },
  },
}
