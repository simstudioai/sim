import type {
  RipplingListDepartmentsParams,
  RipplingListDepartmentsResponse,
} from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingListDepartmentsTool: ToolConfig<
  RipplingListDepartmentsParams,
  RipplingListDepartmentsResponse
> = {
  id: 'rippling_list_departments',
  name: 'Rippling List Departments',
  description: 'List all departments in the Rippling organization',
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
      description: 'Maximum number of departments to return',
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
      return `https://api.rippling.com/platform/api/departments${qs ? `?${qs}` : ''}`
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

    const departments = results.map((dept: Record<string, unknown>) => ({
      id: (dept.id as string) ?? '',
      name: (dept.name as string) ?? null,
      parent: (dept.parent as string) ?? null,
    }))

    return {
      success: true,
      output: {
        departments,
        totalCount: departments.length,
      },
    }
  },

  outputs: {
    departments: {
      type: 'array',
      description: 'List of departments',
      items: {
        type: 'json',
        properties: {
          id: { type: 'string', description: 'Department ID' },
          name: { type: 'string', description: 'Department name' },
          parent: { type: 'string', description: 'Parent department ID' },
        },
      },
    },
    totalCount: {
      type: 'number',
      description: 'Number of departments returned on this page',
    },
  },
}
