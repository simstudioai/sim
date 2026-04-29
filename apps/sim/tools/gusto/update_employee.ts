import type { GustoEmployeeRecordResponse, GustoUpdateEmployeeParams } from '@/tools/gusto/types'
import { EMPLOYEE_OUTPUT_PROPERTIES } from '@/tools/gusto/types'
import { GUSTO_API_BASE, gustoErrorMessage, gustoHeaders } from '@/tools/gusto/utils'
import type { ToolConfig } from '@/tools/types'

export const gustoUpdateEmployeeTool: ToolConfig<
  GustoUpdateEmployeeParams,
  GustoEmployeeRecordResponse
> = {
  id: 'gusto_update_employee',
  name: 'Gusto Update Employee',
  description: 'Update an existing Gusto employee',
  version: '1.0.0',

  oauth: { required: true, provider: 'gusto' },

  params: {
    employeeId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Gusto employee UUID',
    },
    version: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Current version of the employee record (required for updates)',
    },
    firstName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Employee first name',
    },
    lastName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Employee last name',
    },
    middleInitial: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Middle initial',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Work email',
    },
    dateOfBirth: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Date of birth (YYYY-MM-DD)',
    },
    ssn: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Social security number (digits only)',
    },
    preferredFirstName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Preferred first name',
    },
    twoPercentShareholder: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the employee is a 2% shareholder',
    },
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token',
    },
  },

  request: {
    url: (params) => `${GUSTO_API_BASE}/employees/${encodeURIComponent(params.employeeId.trim())}`,
    method: 'PUT',
    headers: (params) => gustoHeaders(params.accessToken),
    body: (params) => {
      const body: Record<string, unknown> = { version: params.version }
      if (params.firstName) body.first_name = params.firstName
      if (params.lastName) body.last_name = params.lastName
      if (params.middleInitial) body.middle_initial = params.middleInitial
      if (params.email) body.email = params.email
      if (params.dateOfBirth) body.date_of_birth = params.dateOfBirth
      if (params.ssn) body.ssn = params.ssn
      if (params.preferredFirstName) body.preferred_first_name = params.preferredFirstName
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
        error: gustoErrorMessage(data, 'Failed to update employee'),
        output: {},
      }
    }
    return { success: true, output: { employee: data } }
  },

  outputs: {
    employee: {
      type: 'object',
      description: 'Updated Gusto employee',
      properties: EMPLOYEE_OUTPUT_PROPERTIES,
    },
  },
}
