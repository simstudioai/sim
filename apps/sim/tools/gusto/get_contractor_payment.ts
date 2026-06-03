import type {
  GustoContractorPaymentRecordResponse,
  GustoGetContractorPaymentParams,
} from '@/tools/gusto/types'
import { CONTRACTOR_PAYMENT_OUTPUT_PROPERTIES } from '@/tools/gusto/types'
import { GUSTO_API_BASE, gustoErrorMessage, gustoHeaders } from '@/tools/gusto/utils'
import type { ToolConfig } from '@/tools/types'

export const gustoGetContractorPaymentTool: ToolConfig<
  GustoGetContractorPaymentParams,
  GustoContractorPaymentRecordResponse
> = {
  id: 'gusto_get_contractor_payment',
  name: 'Gusto Get Contractor Payment',
  description: 'Retrieve a single Gusto contractor payment by ID',
  version: '1.0.0',

  oauth: { required: true, provider: 'gusto' },

  params: {
    companyId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Gusto company UUID',
    },
    contractorPaymentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Gusto contractor payment UUID',
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
      )}/contractor_payments/${encodeURIComponent(params.contractorPaymentId.trim())}`,
    method: 'GET',
    headers: (params) => gustoHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      return {
        success: false,
        error: gustoErrorMessage(data, 'Failed to get contractor payment'),
        output: {},
      }
    }
    return { success: true, output: { contractorPayment: data } }
  },

  outputs: {
    contractorPayment: {
      type: 'object',
      description: 'Contractor payment',
      properties: CONTRACTOR_PAYMENT_OUTPUT_PROPERTIES,
    },
  },
}
