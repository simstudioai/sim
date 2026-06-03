import type {
  GustoContractorPaymentsListResponse,
  GustoListContractorPaymentsParams,
} from '@/tools/gusto/types'
import { CONTRACTOR_PAYMENT_OUTPUT_PROPERTIES } from '@/tools/gusto/types'
import { GUSTO_API_BASE, gustoErrorMessage, gustoHeaders } from '@/tools/gusto/utils'
import type { ToolConfig } from '@/tools/types'

export const gustoListContractorPaymentsTool: ToolConfig<
  GustoListContractorPaymentsParams,
  GustoContractorPaymentsListResponse
> = {
  id: 'gusto_list_contractor_payments',
  name: 'Gusto List Contractor Payments',
  description: 'List contractor payments for a Gusto company',
  version: '1.0.0',

  oauth: { required: true, provider: 'gusto' },

  params: {
    companyId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Gusto company UUID',
    },
    startDate: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Start date filter (YYYY-MM-DD)',
    },
    endDate: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'End date filter (YYYY-MM-DD)',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number',
    },
    per: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Items per page',
    },
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token',
    },
  },

  request: {
    url: (params) => {
      const search = new URLSearchParams()
      search.set('start_date', params.startDate)
      search.set('end_date', params.endDate)
      if (params.page !== undefined) search.set('page', String(params.page))
      if (params.per !== undefined) search.set('per', String(params.per))
      const qs = search.toString()
      return `${GUSTO_API_BASE}/companies/${encodeURIComponent(
        params.companyId.trim()
      )}/contractor_payments${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => gustoHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      return {
        success: false,
        error: gustoErrorMessage(data, 'Failed to list contractor payments'),
        output: {},
      }
    }
    const payments = Array.isArray(data) ? data : (data.contractor_payments ?? [])
    return { success: true, output: { contractorPayments: payments } }
  },

  outputs: {
    contractorPayments: {
      type: 'array',
      description: 'Contractor payments',
      items: { type: 'object', properties: CONTRACTOR_PAYMENT_OUTPUT_PROPERTIES },
    },
  },
}
