import type {
  RipplingListEmployeesParams,
  RipplingListEmployeesResponse,
} from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingListEmployeesTool: ToolConfig<
  RipplingListEmployeesParams,
  RipplingListEmployeesResponse
> = {
  id: 'rippling_list_employees',
  name: 'Rippling List Employees',
  description: 'List all employees in Rippling with optional pagination',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rippling API key',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of employees to return (default 100, max 100)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Offset for pagination',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      if (params.limit != null) query.set('limit', String(params.limit))
      if (params.offset != null) query.set('offset', String(params.offset))
      const qs = query.toString()
      return `https://api.rippling.com/platform/api/employees${qs ? `?${qs}` : ''}`
    },
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

    const data = await response.json()
    const results = Array.isArray(data) ? data : (data.results ?? [])

    const employees = results.map((emp: Record<string, unknown>) => ({
      id: (emp.id as string) ?? '',
      firstName: (emp.firstName as string) ?? null,
      lastName: (emp.lastName as string) ?? null,
      workEmail: (emp.workEmail as string) ?? null,
      personalEmail: (emp.personalEmail as string) ?? null,
      roleState: (emp.roleState as string) ?? null,
      department: (emp.department as string) ?? null,
      title: (emp.title as string) ?? null,
      startDate: (emp.startDate as string) ?? null,
      endDate: (emp.endDate as string) ?? null,
      manager: (emp.manager as string) ?? null,
      phone: (emp.phone as string) ?? null,
    }))

    return {
      success: true,
      output: {
        employees,
        totalCount: employees.length,
      },
    }
  },

  outputs: {
    employees: {
      type: 'array',
      description: 'List of employees',
      items: {
        type: 'json',
        properties: {
          id: { type: 'string', description: 'Employee ID' },
          firstName: { type: 'string', description: 'First name' },
          lastName: { type: 'string', description: 'Last name' },
          workEmail: { type: 'string', description: 'Work email address' },
          personalEmail: { type: 'string', description: 'Personal email address' },
          roleState: { type: 'string', description: 'Employment status' },
          department: { type: 'string', description: 'Department name or ID' },
          title: { type: 'string', description: 'Job title' },
          startDate: { type: 'string', description: 'Employment start date' },
          endDate: { type: 'string', description: 'Employment end date' },
          manager: { type: 'string', description: 'Manager ID or name' },
          phone: { type: 'string', description: 'Phone number' },
        },
      },
    },
    totalCount: {
      type: 'number',
      description: 'Number of employees returned on this page',
    },
  },
}
