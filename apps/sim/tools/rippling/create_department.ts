import type { RipplingCreateDepartmentParams } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingCreateDepartmentTool: ToolConfig<RipplingCreateDepartmentParams> = {
  id: 'rippling_create_department',
  name: 'Rippling Create Department',
  description: 'Create a new department',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rippling API key',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Department name',
    },
    parentId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Parent department ID',
    },
    referenceCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Reference code',
    },
  },
  request: {
    url: `https://rest.ripplingapis.com/departments/`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = { name: params.name }
      if (params.parentId != null) body.parent_id = params.parentId
      if (params.referenceCode != null) body.reference_code = params.referenceCode
      return body
    },
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
      },
    }
  },
  outputs: {
    id: { type: 'string', description: 'Department ID' },
    created_at: { type: 'string', description: 'Creation date', optional: true },
    updated_at: { type: 'string', description: 'Update date', optional: true },
    name: { type: 'string', description: 'Name', optional: true },
    parent_id: { type: 'string', description: 'Parent department ID', optional: true },
    reference_code: { type: 'string', description: 'Reference code', optional: true },
    department_hierarchy_id: {
      type: 'json',
      description: 'Department hierarchy IDs',
      optional: true,
    },
    parent: { type: 'json', description: 'Expanded parent department', optional: true },
    department_hierarchy: {
      type: 'json',
      description: 'Expanded department hierarchy',
      optional: true,
    },
  },
}
