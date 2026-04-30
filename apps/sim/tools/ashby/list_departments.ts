import { ashbyAuthHeaders, ashbyErrorMessage } from '@/tools/ashby/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface AshbyListDepartmentsParams {
  apiKey: string
  cursor?: string
  perPage?: number
  syncToken?: string
  includeArchived?: boolean
}

interface AshbyDepartment {
  id: string
  name: string
  externalName: string | null
  isArchived: boolean
  parentId: string | null
  createdAt: string | null
  updatedAt: string | null
  extraData: Record<string, unknown> | null
}

interface AshbyListDepartmentsResponse extends ToolResponse {
  output: {
    departments: AshbyDepartment[]
    moreDataAvailable: boolean
    nextCursor: string | null
    syncToken: string | null
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
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Opaque pagination cursor from a previous response nextCursor value',
    },
    perPage: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per page (default and max 100)',
    },
    syncToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Opaque token from a prior sync to fetch only items changed since then',
    },
    includeArchived: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'When true, includes archived departments in results (default false)',
    },
  },

  request: {
    url: 'https://api.ashbyhq.com/department.list',
    method: 'POST',
    headers: (params) => ashbyAuthHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.cursor) body.cursor = params.cursor
      if (params.perPage) body.limit = params.perPage
      if (params.syncToken) body.syncToken = params.syncToken
      if (params.includeArchived !== undefined) body.includeArchived = params.includeArchived
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(ashbyErrorMessage(data, 'Failed to list departments'))
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
          extraData: (d.extraData as Record<string, unknown>) ?? null,
        })),
        moreDataAvailable: data.moreDataAvailable ?? false,
        nextCursor: data.nextCursor ?? null,
        syncToken: data.syncToken ?? null,
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
          extraData: {
            type: 'json',
            description: 'Free-form key-value metadata',
            optional: true,
          },
        },
      },
    },
    moreDataAvailable: {
      type: 'boolean',
      description: 'Whether more pages of results exist',
    },
    nextCursor: {
      type: 'string',
      description: 'Opaque cursor for fetching the next page',
      optional: true,
    },
    syncToken: {
      type: 'string',
      description: 'Opaque sync token returned after the last page; pass on next sync',
      optional: true,
    },
  },
}
