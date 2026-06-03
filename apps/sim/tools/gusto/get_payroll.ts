import type { GustoGetPayrollParams, GustoGetPayrollResponse } from '@/tools/gusto/types'
import { PAYROLL_OUTPUT_PROPERTIES } from '@/tools/gusto/types'
import { GUSTO_API_BASE, gustoErrorMessage, gustoHeaders } from '@/tools/gusto/utils'
import type { ToolConfig } from '@/tools/types'

export const gustoGetPayrollTool: ToolConfig<GustoGetPayrollParams, GustoGetPayrollResponse> = {
  id: 'gusto_get_payroll',
  name: 'Gusto Get Payroll',
  description: 'Retrieve a single payroll by ID',
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
    payrollId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Gusto payroll UUID',
    },
    include: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated extra fields to include (e.g. "taxes,benefits,deductions"). Required to retrieve calculated payroll details.',
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
      if (params.include) search.set('include', params.include)
      const qs = search.toString()
      return `${GUSTO_API_BASE}/companies/${encodeURIComponent(
        params.companyId.trim()
      )}/payrolls/${encodeURIComponent(params.payrollId.trim())}${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => gustoHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      return {
        success: false,
        error: gustoErrorMessage(data, 'Failed to fetch payroll'),
        output: {},
      }
    }
    return {
      success: true,
      output: { payroll: data },
    }
  },

  outputs: {
    payroll: {
      type: 'object',
      description: 'Gusto payroll',
      properties: PAYROLL_OUTPUT_PROPERTIES,
    },
  },
}
