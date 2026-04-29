import type { GustoPayrollRecordResponse, GustoSubmitPayrollParams } from '@/tools/gusto/types'
import { PAYROLL_OUTPUT_PROPERTIES } from '@/tools/gusto/types'
import { GUSTO_API_BASE, gustoErrorMessage, gustoHeaders } from '@/tools/gusto/utils'
import type { ToolConfig } from '@/tools/types'

export const gustoSubmitPayrollTool: ToolConfig<
  GustoSubmitPayrollParams,
  GustoPayrollRecordResponse
> = {
  id: 'gusto_submit_payroll',
  name: 'Gusto Submit Payroll',
  description: 'Submit a calculated Gusto payroll for processing',
  version: '1.0.0',

  oauth: { required: true, provider: 'gusto' },

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
      )}/payrolls/${encodeURIComponent(params.payrollId.trim())}/submit`,
    method: 'PUT',
    headers: (params) => gustoHeaders(params.accessToken),
    body: () => ({}),
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      return {
        success: false,
        error: gustoErrorMessage(data, 'Failed to submit payroll'),
        output: {},
      }
    }
    if (response.status === 202 || response.status === 204) {
      return { success: true, output: { payroll: { status: 'submitting' } } }
    }
    const data = await response.json().catch(() => ({}))
    return { success: true, output: { payroll: data } }
  },

  outputs: {
    payroll: {
      type: 'object',
      description: 'Submitted payroll',
      properties: PAYROLL_OUTPUT_PROPERTIES,
    },
  },
}
