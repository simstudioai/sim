import type { RipplingListDepartmentsParams } from '@/tools/rippling/types'
import { DEPARTMENT_OUTPUT_PROPERTIES } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingListDepartmentsTool: ToolConfig<RipplingListDepartmentsParams> = {
  id: 'rippling_list_departments',
  name: 'Rippling List Departments',
  description: 'List all departments',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rippling API key',
    },
    expand: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated fields to expand',
    },
    orderBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort field. Prefix with - for descending',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from previous response',
    },
  },
  request: {
    url: (params) => {
      const query = new URLSearchParams()
      if (params.expand != null) query.set('expand', params.expand)
      if (params.orderBy != null) query.set('order_by', params.orderBy)
      if (params.cursor != null) query.set('cursor', params.cursor)
      const qs = query.toString()
      return `https://rest.ripplingapis.com/departments/${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => ({ Authorization: `Bearer ${params.apiKey}`, Accept: 'application/json' }),
  },
  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Rippling API error (${response.status}): ${errorText}`)
    }
    const data = await response.json()
    const results = data.results ?? []
    return {
      success: true,
      output: {
        departments: results.map((item: Record<string, unknown>) => ({
          id: (item.id as string) ?? '',
          created_at: (item.created_at as string) ?? null,
          updated_at: (item.updated_at as string) ?? null,
          name: (item.name as string) ?? null,
          parent_id: (item.parent_id as string) ?? null,
          reference_code: (item.reference_code as string) ?? null,
          department_hierarchy_id: (item.department_hierarchy_id as unknown[]) ?? [],
          parent: item.parent ?? null,
          department_hierarchy: item.department_hierarchy ?? null,
        })),
        totalCount: results.length,
        nextLink: (data.next_link as string) ?? null,
        __meta: data.__meta ?? null,
      },
    }
  },
  outputs: {
    departments: {
      type: 'array',
      description: 'List of departments',
      items: { type: 'object', properties: DEPARTMENT_OUTPUT_PROPERTIES },
    },
    totalCount: { type: 'number', description: 'Number of items returned' },
    nextLink: { type: 'string', description: 'Link to next page of results', optional: true },
    __meta: { type: 'json', description: 'Metadata including redacted_fields', optional: true },
  },
}
