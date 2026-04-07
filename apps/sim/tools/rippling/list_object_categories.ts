import type { RipplingListObjectCategoriesParams } from '@/tools/rippling/types'
import { OBJECT_CATEGORY_OUTPUT_PROPERTIES } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingListObjectCategoriesTool: ToolConfig<RipplingListObjectCategoriesParams> = {
  id: 'rippling_list_object_categories',
  name: 'Rippling List Object Categories',
  description: 'List all object categories',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rippling API key',
    },
  },
  request: {
    url: `https://rest.ripplingapis.com/object-categories/`,
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
        objectCategories: results.map((item: Record<string, unknown>) => ({
          id: (item.id as string) ?? '',
          created_at: (item.created_at as string) ?? null,
          updated_at: (item.updated_at as string) ?? null,
          name: (item.name as string) ?? null,
          description: (item.description as string) ?? null,
        })),
        totalCount: results.length,
        nextLink: (data.next_link as string) ?? null,
      },
    }
  },
  outputs: {
    objectCategories: {
      type: 'array',
      description: 'List of objectCategories',
      items: { type: 'object', properties: OBJECT_CATEGORY_OUTPUT_PROPERTIES },
    },
    totalCount: { type: 'number', description: 'Number of items returned' },
    nextLink: { type: 'string', description: 'Link to next page of results', optional: true },
  },
}
