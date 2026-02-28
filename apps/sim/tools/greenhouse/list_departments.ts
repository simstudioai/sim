import type {
  GreenhouseDepartment,
  GreenhouseListDepartmentsParams,
  GreenhouseListDepartmentsResponse,
} from '@/tools/greenhouse/types'
import type { ToolConfig } from '@/tools/types'

export const greenhouseListDepartmentsTool: ToolConfig<
  GreenhouseListDepartmentsParams,
  GreenhouseListDepartmentsResponse
> = {
  id: 'greenhouse_list_departments',
  name: 'Greenhouse List Departments',
  description: 'Lists all departments configured in Greenhouse',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Greenhouse Harvest API key',
    },
    per_page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per page (1-500, default 100)',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number for pagination',
    },
  },

  request: {
    url: (params: GreenhouseListDepartmentsParams) => {
      const url = new URL('https://harvest.greenhouse.io/v1/departments')
      if (params.per_page) url.searchParams.append('per_page', String(params.per_page))
      if (params.page) url.searchParams.append('page', String(params.page))
      return url.toString()
    },
    method: 'GET',
    headers: (params: GreenhouseListDepartmentsParams) => ({
      Authorization: `Basic ${btoa(`${params.apiKey}:`)}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response): Promise<GreenhouseListDepartmentsResponse> => {
    if (!response.ok) {
      return {
        success: false,
        output: { departments: [], count: 0 },
        error: `Greenhouse API error: ${response.status} ${response.statusText}`,
      }
    }

    const data = await response.json()
    const departments: GreenhouseDepartment[] = (Array.isArray(data) ? data : []).map(
      (d: Record<string, unknown>) => ({
        id: (d.id as number) ?? 0,
        name: (d.name as string) ?? null,
        parent_id: (d.parent_id as number) ?? null,
        child_ids: (d.child_ids as number[]) ?? [],
        external_id: (d.external_id as string) ?? null,
      })
    )
    return {
      success: true,
      output: { departments, count: departments.length },
    }
  },

  outputs: {
    departments: {
      type: 'array',
      description: 'List of departments',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Department ID' },
          name: { type: 'string', description: 'Department name' },
          parent_id: { type: 'number', description: 'Parent department ID', optional: true },
          child_ids: {
            type: 'array',
            description: 'Child department IDs',
            items: { type: 'number', description: 'Department ID' },
          },
          external_id: { type: 'string', description: 'External system ID', optional: true },
        },
      },
    },
    count: { type: 'number', description: 'Number of departments returned' },
  },
}
