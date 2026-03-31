import type { ToolConfig } from '@/tools/types'
import type { ProfoundCategoryTagsParams, ProfoundCategoryTagsResponse } from './types'

export const profoundCategoryTagsTool: ToolConfig<
  ProfoundCategoryTagsParams,
  ProfoundCategoryTagsResponse
> = {
  id: 'profound_category_tags',
  name: 'Profound Category Tags',
  description: 'List tags for a specific category in Profound',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Profound API Key',
    },
    categoryId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Category ID (UUID)',
    },
  },

  request: {
    url: (params) =>
      `https://api.tryprofound.com/v1/org/categories/${encodeURIComponent(params.categoryId)}/tags`,
    method: 'GET',
    headers: (params) => ({
      'X-API-Key': params.apiKey,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.detail?.[0]?.msg || 'Failed to list category tags')
    }
    return {
      success: true,
      output: {
        tags: (data ?? []).map((item: { id: string; name: string }) => ({
          id: item.id ?? null,
          name: item.name ?? null,
        })),
      },
    }
  },

  outputs: {
    tags: {
      type: 'json',
      description: 'List of tags in the category',
      properties: {
        id: { type: 'string', description: 'Tag ID (UUID)' },
        name: { type: 'string', description: 'Tag name' },
      },
    },
  },
}
