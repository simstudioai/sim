import type { GustoTerminateEmployeeParams, GustoTerminationResponse } from '@/tools/gusto/types'
import { TERMINATION_OUTPUT_PROPERTIES } from '@/tools/gusto/types'
import { GUSTO_API_BASE, gustoErrorMessage, gustoHeaders } from '@/tools/gusto/utils'
import type { ToolConfig } from '@/tools/types'

export const gustoTerminateEmployeeTool: ToolConfig<
  GustoTerminateEmployeeParams,
  GustoTerminationResponse
> = {
  id: 'gusto_terminate_employee',
  name: 'Gusto Terminate Employee',
  description: 'Create a termination for a Gusto employee',
  version: '1.0.0',

  oauth: { required: true, provider: 'gusto' },

  params: {
    employeeId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Gusto employee UUID',
    },
    effectiveDate: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Termination effective date (YYYY-MM-DD)',
    },
    runTerminationPayroll: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'If true, the employee receives final wages via off-cycle payroll. If false, on their current pay schedule.',
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
      `${GUSTO_API_BASE}/employees/${encodeURIComponent(params.employeeId.trim())}/terminations`,
    method: 'POST',
    headers: (params) => gustoHeaders(params.accessToken),
    body: (params) => {
      const body: Record<string, unknown> = { effective_date: params.effectiveDate }
      if (params.runTerminationPayroll !== undefined) {
        body.run_termination_payroll = params.runTerminationPayroll
      }
      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      return {
        success: false,
        error: gustoErrorMessage(data, 'Failed to terminate employee'),
        output: {},
      }
    }
    return { success: true, output: { termination: data } }
  },

  outputs: {
    termination: {
      type: 'object',
      description: 'Employee termination record',
      properties: TERMINATION_OUTPUT_PROPERTIES,
    },
  },
}
