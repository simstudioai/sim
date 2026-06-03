import type { GustoCreateEmployeeParams, GustoCreateEmployeeResponse } from '@/tools/gusto/types'
import { EMPLOYEE_OUTPUT_PROPERTIES } from '@/tools/gusto/types'
import { GUSTO_API_BASE, gustoErrorMessage, gustoHeaders } from '@/tools/gusto/utils'
import type { ToolConfig } from '@/tools/types'

export const gustoCreateEmployeeTool: ToolConfig<
  GustoCreateEmployeeParams,
  GustoCreateEmployeeResponse
> = {
  id: 'gusto_create_employee',
  name: 'Gusto Create Employee',
  description: 'Create a new employee in a Gusto company',
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
    firstName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Employee first name',
    },
    lastName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Employee last name',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Employee personal email address',
    },
    middleInitial: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Middle initial',
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
    selfOnboarding: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Send self-onboarding invite to employee',
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
      `${GUSTO_API_BASE}/companies/${encodeURIComponent(params.companyId.trim())}/employees`,
    method: 'POST',
    headers: (params) => gustoHeaders(params.accessToken),
    body: (params) => {
      const body: Record<string, unknown> = {
        first_name: params.firstName,
        last_name: params.lastName,
      }
      if (params.email) body.email = params.email
      if (params.middleInitial) body.middle_initial = params.middleInitial
      if (params.dateOfBirth) body.date_of_birth = params.dateOfBirth
      if (params.ssn) body.ssn = params.ssn
      if (params.selfOnboarding !== undefined) body.self_onboarding = params.selfOnboarding
      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      return {
        success: false,
        error: gustoErrorMessage(data, 'Failed to create employee'),
        output: {},
      }
    }
    return {
      success: true,
      output: { employee: data },
    }
  },

  outputs: {
    employee: {
      type: 'object',
      description: 'Created Gusto employee',
      properties: EMPLOYEE_OUTPUT_PROPERTIES,
    },
  },
}
