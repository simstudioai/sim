import type { ToolConfig } from '@/tools/types'
import type { ProfoundListCategoriesParams, ProfoundListCategoriesResponse } from './types'

export const profoundListCategoriesTool: ToolConfig<
  ProfoundListCategoriesParams,
  ProfoundListCategoriesResponse
> = {
  id: 'profound_list_categories',
  name: 'Profound List Categories',
  description: 'List all organization categories in Profound',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Profound API Key',
    },
  },

  request: {
    url: 'https://api.tryprofound.com/v1/org/categories',
    method: 'GET',
    headers: (params) => ({
      'X-API-Key': params.apiKey,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.detail?.[0]?.msg || 'Failed to list categories')
    }
    return {
      success: true,
      output: {
        categories: (data ?? []).map((item: { id: string; name: string }) => ({
          id: item.id ?? null,
          name: item.name ?? null,
        })),
      },
    }
  },

  outputs: {
    categories: {
      type: 'json',
      description: 'List of organization categories',
      properties: {
        id: { type: 'string', description: 'Category ID' },
        name: { type: 'string', description: 'Category name' },
      },
    },
  },
}
