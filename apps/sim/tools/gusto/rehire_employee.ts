import type { GustoRehireEmployeeParams, GustoRehireResponse } from '@/tools/gusto/types'
import { REHIRE_OUTPUT_PROPERTIES } from '@/tools/gusto/types'
import { GUSTO_API_BASE, gustoErrorMessage, gustoHeaders } from '@/tools/gusto/utils'
import type { ToolConfig } from '@/tools/types'

export const gustoRehireEmployeeTool: ToolConfig<GustoRehireEmployeeParams, GustoRehireResponse> = {
  id: 'gusto_rehire_employee',
  name: 'Gusto Rehire Employee',
  description: 'Schedule a rehire for a Gusto employee',
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
      description: 'The day when the employee returns to work (YYYY-MM-DD)',
    },
    fileNewHireReport: {
      type: 'boolean',
      required: true,
      visibility: 'user-or-llm',
      description: 'Whether Gusto will file a new hire report for the employee',
    },
    workLocationUuid: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "UUID of the employee's work location",
    },
    employmentStatus: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Employment status (part_time, full_time, part_time_eligible, variable, seasonal, not_set)',
    },
    twoPercentShareholder: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the employee is a 2% shareholder (S-Corp companies only)',
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
      `${GUSTO_API_BASE}/employees/${encodeURIComponent(params.employeeId.trim())}/rehire`,
    method: 'POST',
    headers: (params) => gustoHeaders(params.accessToken),
    body: (params) => {
      const body: Record<string, unknown> = {
        effective_date: params.effectiveDate,
        file_new_hire_report: params.fileNewHireReport,
        work_location_uuid: params.workLocationUuid,
      }
      if (params.employmentStatus) body.employment_status = params.employmentStatus
      if (params.twoPercentShareholder !== undefined) {
        body.two_percent_shareholder = params.twoPercentShareholder
      }
      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      return {
        success: false,
        error: gustoErrorMessage(data, 'Failed to rehire employee'),
        output: {},
      }
    }
    return { success: true, output: { rehire: data } }
  },

  outputs: {
    rehire: {
      type: 'object',
      description: 'Employee rehire record',
      properties: REHIRE_OUTPUT_PROPERTIES,
    },
  },
}
