import type { RipplingGetDepartmentParams } from '@/tools/rippling/types'
import { DEPARTMENT_OUTPUT_PROPERTIES } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingGetDepartmentTool: ToolConfig<RipplingGetDepartmentParams> = {
  id: 'rippling_get_department',
  name: 'Rippling Get Department',
  description: 'Get a specific department by ID',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rippling API key',
    },
    id: { type: 'string', required: true, visibility: 'user-or-llm', description: 'Resource ID' },
    expand: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated fields to expand',
    },
  },
  request: {
    url: (params) => {
      const base = `https://rest.ripplingapis.com/departments/${encodeURIComponent(params.id.trim())}/`
      if (params.expand != null) return `${base}?expand=${encodeURIComponent(params.expand)}`
      return base
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
    return {
      success: true,
      output: {
        id: (data.id as string) ?? '',
        created_at: (data.created_at as string) ?? null,
        updated_at: (data.updated_at as string) ?? null,
        name: (data.name as string) ?? null,
        parent_id: (data.parent_id as string) ?? null,
        reference_code: (data.reference_code as string) ?? null,
        department_hierarchy_id: (data.department_hierarchy_id as unknown[]) ?? [],
        parent: data.parent ?? null,
        department_hierarchy: data.department_hierarchy ?? null,
        __meta: data.__meta ?? null,
      },
    }
  },
  outputs: {
    ...DEPARTMENT_OUTPUT_PROPERTIES,
    __meta: { type: 'json', description: 'Metadata including redacted_fields', optional: true },
  },
}
