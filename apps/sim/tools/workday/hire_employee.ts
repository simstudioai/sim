import type { ToolConfig } from '@/tools/types'
import type { WorkdayHireEmployeeParams, WorkdayHireEmployeeResponse } from '@/tools/workday/types'

export const hireEmployeeTool: ToolConfig<WorkdayHireEmployeeParams, WorkdayHireEmployeeResponse> =
  {
    id: 'workday_hire_employee',
    name: 'Hire Workday Employee',
    description:
      'Hire a pre-hire into an employee position. Converts an applicant into an active employee record with position, start date, and manager assignment.',
    version: '1.0.0',

    params: {
      tenantUrl: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Workday instance URL (e.g., https://wd5-impl-services1.workday.com)',
      },
      tenant: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Workday tenant name',
      },
      username: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Integration System User username',
      },
      password: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Integration System User password',
      },
      preHireId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Pre-hire (applicant) ID to convert into an employee',
      },
      positionId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Position ID to assign the new hire to',
      },
      hireDate: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Hire date in ISO 8601 format (e.g., 2025-06-01)',
      },
      employeeType: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Employee type (e.g., Regular, Temporary, Contractor)',
      },
    },

    request: {
      url: '/api/tools/workday/hire',
      method: 'POST',
      headers: () => ({
        'Content-Type': 'application/json',
      }),
      body: (params) => params,
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error ?? 'Workday API request failed')
      }
      return data
    },

    outputs: {
      workerId: {
        type: 'string',
        description: 'Worker ID of the newly hired employee',
      },
      employeeId: {
        type: 'string',
        description: 'Employee ID assigned to the new hire',
      },
      eventId: {
        type: 'string',
        description: 'Event ID of the hire business process',
      },
      hireDate: {
        type: 'string',
        description: 'Effective hire date',
      },
    },
  }
