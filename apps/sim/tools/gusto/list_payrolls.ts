import type { GustoListPayrollsParams, GustoListPayrollsResponse } from '@/tools/gusto/types'
import { PAYROLL_OUTPUT_PROPERTIES } from '@/tools/gusto/types'
import { GUSTO_API_BASE, gustoErrorMessage, gustoHeaders } from '@/tools/gusto/utils'
import type { ToolConfig } from '@/tools/types'

export const gustoListPayrollsTool: ToolConfig<GustoListPayrollsParams, GustoListPayrollsResponse> =
  {
    id: 'gusto_list_payrolls',
    name: 'Gusto List Payrolls',
    description: 'List payrolls for a Gusto company',
    version: '1.0.0',

    oauth: {
      required: true,
      provider: 'gusto',
    },

    params: {
      companyId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Gusto company UUID',
      },
      startDate: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Start date filter (YYYY-MM-DD)',
      },
      endDate: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'End date filter (YYYY-MM-DD)',
      },
      processingStatuses: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Comma-separated statuses (processed, unprocessed). Defaults to "processed" if omitted',
      },
      payrollTypes: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Comma-separated payroll types (regular, off_cycle, external). Defaults to "regular" if omitted',
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
        if (params.startDate) search.set('start_date', params.startDate)
        if (params.endDate) search.set('end_date', params.endDate)
        if (params.processingStatuses) search.set('processing_statuses', params.processingStatuses)
        if (params.payrollTypes) search.set('payroll_types', params.payrollTypes)
        const qs = search.toString()
        return `${GUSTO_API_BASE}/companies/${encodeURIComponent(
          params.companyId.trim()
        )}/payrolls${qs ? `?${qs}` : ''}`
      },
      method: 'GET',
      headers: (params) => gustoHeaders(params.accessToken),
    },

    transformResponse: async (response) => {
      const data = await response.json()
      if (!response.ok) {
        return {
          success: false,
          error: gustoErrorMessage(data, 'Failed to list payrolls'),
          output: {},
        }
      }
      return {
        success: true,
        output: { payrolls: Array.isArray(data) ? data : (data.payrolls ?? []) },
      }
    },

    outputs: {
      payrolls: {
        type: 'array',
        description: 'List of payrolls',
        items: {
          type: 'object',
          properties: PAYROLL_OUTPUT_PROPERTIES,
        },
      },
    },
  }
