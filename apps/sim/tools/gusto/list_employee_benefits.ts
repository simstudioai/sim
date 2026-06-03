import type {
  GustoEmployeeBenefitsListResponse,
  GustoListEmployeeBenefitsParams,
} from '@/tools/gusto/types'
import { EMPLOYEE_BENEFIT_OUTPUT_PROPERTIES } from '@/tools/gusto/types'
import { GUSTO_API_BASE, gustoErrorMessage, gustoHeaders } from '@/tools/gusto/utils'
import type { ToolConfig } from '@/tools/types'

export const gustoListEmployeeBenefitsTool: ToolConfig<
  GustoListEmployeeBenefitsParams,
  GustoEmployeeBenefitsListResponse
> = {
  id: 'gusto_list_employee_benefits',
  name: 'Gusto List Employee Benefits',
  description: 'List all benefits enrolled for a Gusto employee',
  version: '1.0.0',

  oauth: { required: true, provider: 'gusto' },

  params: {
    employeeId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Gusto employee UUID',
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
      `${GUSTO_API_BASE}/employees/${encodeURIComponent(
        params.employeeId.trim()
      )}/employee_benefits`,
    method: 'GET',
    headers: (params) => gustoHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      return {
        success: false,
        error: gustoErrorMessage(data, 'Failed to list employee benefits'),
        output: {},
      }
    }
    return {
      success: true,
      output: {
        employeeBenefits: Array.isArray(data)
          ? data
          : (data.employee_benefits ?? data.employeeBenefits ?? []),
      },
    }
  },

  outputs: {
    employeeBenefits: {
      type: 'array',
      description: 'Employee benefits',
      items: { type: 'object', properties: EMPLOYEE_BENEFIT_OUTPUT_PROPERTIES },
    },
  },
}
