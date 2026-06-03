import type {
  GustoContractorPaymentRecordResponse,
  GustoCreateContractorPaymentParams,
} from '@/tools/gusto/types'
import { CONTRACTOR_PAYMENT_OUTPUT_PROPERTIES } from '@/tools/gusto/types'
import { GUSTO_API_BASE, gustoErrorMessage, gustoHeaders } from '@/tools/gusto/utils'
import type { ToolConfig } from '@/tools/types'

export const gustoCreateContractorPaymentTool: ToolConfig<
  GustoCreateContractorPaymentParams,
  GustoContractorPaymentRecordResponse
> = {
  id: 'gusto_create_contractor_payment',
  name: 'Gusto Create Contractor Payment',
  description: 'Pay a Gusto contractor (one-off payment)',
  version: '1.0.0',

  oauth: { required: true, provider: 'gusto' },

  params: {
    companyId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Gusto company UUID',
    },
    contractorUuid: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Gusto contractor UUID',
    },
    date: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Payment date (YYYY-MM-DD)',
    },
    wage: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Fixed wage amount (for Fixed contractors)',
    },
    hours: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Hours worked (for Hourly contractors)',
    },
    bonus: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Bonus amount',
    },
    reimbursement: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Reimbursement amount',
    },
    paymentMethod: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Payment method (Direct Deposit or Check)',
    },
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token',
    },
  },

  request: {
    url: (params) =>
      `${GUSTO_API_BASE}/companies/${encodeURIComponent(
        params.companyId.trim()
      )}/contractor_payments`,
    method: 'POST',
    headers: (params) => gustoHeaders(params.accessToken),
    body: (params) => {
      const body: Record<string, unknown> = {
        contractor_uuid: params.contractorUuid,
        date: params.date,
      }
      if (params.wage !== undefined) body.wage = params.wage
      if (params.hours !== undefined) body.hours = params.hours
      if (params.bonus !== undefined) body.bonus = params.bonus
      if (params.reimbursement !== undefined) body.reimbursement = params.reimbursement
      if (params.paymentMethod) body.payment_method = params.paymentMethod
      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      return {
        success: false,
        error: gustoErrorMessage(data, 'Failed to create contractor payment'),
        output: {},
      }
    }
    return { success: true, output: { contractorPayment: data } }
  },

  outputs: {
    contractorPayment: {
      type: 'object',
      description: 'Created contractor payment',
      properties: CONTRACTOR_PAYMENT_OUTPUT_PROPERTIES,
    },
  },
}
