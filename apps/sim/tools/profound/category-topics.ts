import type { ToolConfig } from '@/tools/types'
import type { ProfoundCategoryTopicsParams, ProfoundCategoryTopicsResponse } from './types'

export const profoundCategoryTopicsTool: ToolConfig<
  ProfoundCategoryTopicsParams,
  ProfoundCategoryTopicsResponse
> = {
  id: 'profound_category_topics',
  name: 'Profound Category Topics',
  description: 'List topics for a specific category in Profound',
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
      `https://api.tryprofound.com/v1/org/categories/${encodeURIComponent(params.categoryId)}/topics`,
    method: 'GET',
    headers: (params) => ({
      'X-API-Key': params.apiKey,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.detail?.[0]?.msg || 'Failed to list category topics')
    }
    return {
      success: true,
      output: {
        topics: (data ?? []).map((item: { id: string; name: string }) => ({
          id: item.id ?? null,
          name: item.name ?? null,
        })),
      },
    }
  },

  outputs: {
    topics: {
      type: 'json',
      description: 'List of topics in the category',
      properties: {
        id: { type: 'string', description: 'Topic ID (UUID)' },
        name: { type: 'string', description: 'Topic name' },
      },
    },
  },
}
