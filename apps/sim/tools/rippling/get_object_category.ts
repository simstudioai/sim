import type { RipplingGetObjectCategoryParams } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingGetObjectCategoryTool: ToolConfig<RipplingGetObjectCategoryParams> = {
  id: 'rippling_get_object_category',
  name: 'Rippling Get ObjectCategory',
  description: 'Get a specific object category',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rippling API key',
    },
    id: { type: 'string', required: true, visibility: 'user-or-llm', description: 'Resource ID' },
  },
  request: {
    url: (params) =>
      `https://rest.ripplingapis.com/object-categories/${encodeURIComponent(params.id.trim())}/`,
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
    return {
      success: true,
      output: {
        id: (data.id as string) ?? '',
        created_at: (data.created_at as string) ?? null,
        updated_at: (data.updated_at as string) ?? null,
        name: (data.name as string) ?? null,
        description: (data.description as string) ?? null,
      },
    }
  },
  outputs: {
    id: { type: 'string', description: 'Category ID' },
    created_at: { type: 'string', description: 'Creation date', optional: true },
    updated_at: { type: 'string', description: 'Update date', optional: true },
    name: { type: 'string', description: 'Name', optional: true },
    description: { type: 'string', description: 'Description', optional: true },
  },
}
