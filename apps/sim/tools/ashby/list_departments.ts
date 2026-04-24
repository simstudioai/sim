import type { ToolConfig, ToolResponse } from '@/tools/types'

interface AshbyListDepartmentsParams {
  apiKey: string
}

interface AshbyDepartment {
  id: string
  name: string
  externalName: string | null
  isArchived: boolean
  parentId: string | null
  createdAt: string | null
  updatedAt: string | null
}

interface AshbyListDepartmentsResponse extends ToolResponse {
  output: {
    departments: AshbyDepartment[]
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
          id: (d.id as string) ?? '',
          name: (d.name as string) ?? '',
          externalName: (d.externalName as string) ?? null,
          isArchived: (d.isArchived as boolean) ?? false,
          parentId: (d.parentId as string) ?? null,
          createdAt: (d.createdAt as string) ?? null,
          updatedAt: (d.updatedAt as string) ?? null,
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
          externalName: {
            type: 'string',
            description: 'Candidate-facing name used on job boards',
            optional: true,
          },
          isArchived: { type: 'boolean', description: 'Whether the department is archived' },
          parentId: {
            type: 'string',
            description: 'Parent department UUID',
            optional: true,
          },
          createdAt: {
            type: 'string',
            description: 'ISO 8601 creation timestamp',
            optional: true,
          },
          updatedAt: {
            type: 'string',
            description: 'ISO 8601 last update timestamp',
            optional: true,
          },
        },
      },
    },
  },
}
