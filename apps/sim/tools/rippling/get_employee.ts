import type { RipplingGetEmployeeParams, RipplingGetEmployeeResponse } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingGetEmployeeTool: ToolConfig<
  RipplingGetEmployeeParams,
  RipplingGetEmployeeResponse
> = {
  id: 'rippling_get_employee',
  name: 'Rippling Get Employee',
  description: 'Get details for a specific employee by ID',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rippling API key',
    },
    employeeId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the employee to retrieve',
    },
  },

  request: {
    url: (params) =>
      `https://api.rippling.com/platform/api/employees/${encodeURIComponent(params.employeeId.trim())}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Rippling API error (${response.status}): ${errorText}`)
    }

    const emp = await response.json()

    return {
      success: true,
      output: {
        id: emp.id ?? '',
        firstName: emp.firstName ?? null,
        lastName: emp.lastName ?? null,
        workEmail: emp.workEmail ?? null,
        personalEmail: emp.personalEmail ?? null,
        roleState: emp.roleState ?? null,
        department: emp.department ?? null,
        title: emp.title ?? null,
        startDate: emp.startDate ?? null,
        endDate: emp.endDate ?? null,
        manager: emp.manager ?? null,
        phone: emp.phone ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Employee ID' },
    firstName: { type: 'string', description: 'First name', optional: true },
    lastName: { type: 'string', description: 'Last name', optional: true },
    workEmail: { type: 'string', description: 'Work email address', optional: true },
    personalEmail: { type: 'string', description: 'Personal email address', optional: true },
    roleState: { type: 'string', description: 'Employment status', optional: true },
    department: { type: 'string', description: 'Department name or ID', optional: true },
    title: { type: 'string', description: 'Job title', optional: true },
    startDate: { type: 'string', description: 'Employment start date', optional: true },
    endDate: { type: 'string', description: 'Employment end date', optional: true },
    manager: { type: 'string', description: 'Manager ID or name', optional: true },
    phone: { type: 'string', description: 'Phone number', optional: true },
  },
}
