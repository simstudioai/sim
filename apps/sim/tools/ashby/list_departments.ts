import type { ToolConfig, ToolResponse } from '@/tools/types'

interface AshbyListDepartmentsParams {
  apiKey: string
}

interface AshbyListDepartmentsResponse extends ToolResponse {
  output: {
    departments: Array<{
      id: string
      name: string
      isArchived: boolean
      parentId: string | null
    }>
  }
}

export const listDepartmentsTool: ToolConfig<
  AshbyListDepartmentsParams,
  AshbyListDepartmentsResponse
> = {
  id: 'ashby_list_departments',
  name: 'Ashby List Departments',
  description: 'Lists all departments in Ashby.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Ashby API Key',
    },
  },

  request: {
    url: 'https://api.ashbyhq.com/department.list',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${params.apiKey}:`)}`,
    }),
    body: () => ({}),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(data.errorInfo?.message || 'Failed to list departments')
    }

    return {
      success: true,
      output: {
        departments: (data.results ?? []).map((d: Record<string, unknown>) => ({
          id: d.id ?? null,
          name: d.name ?? null,
          isArchived: d.isArchived ?? false,
          parentId: (d.parentId as string) ?? null,
        })),
      },
    }
  },

  outputs: {
    departments: {
      type: 'array',
      description: 'List of departments',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Department UUID' },
          name: { type: 'string', description: 'Department name' },
          isArchived: { type: 'boolean', description: 'Whether the department is archived' },
          parentId: {
            type: 'string',
            description: 'Parent department UUID',
            optional: true,
          },
        },
      },
    },
  },
}
