import type { GrainListViewsParams, GrainListViewsResponse } from '@/tools/grain/types'
import type { ToolConfig } from '@/tools/types'

export const grainListViewsTool: ToolConfig<GrainListViewsParams, GrainListViewsResponse> = {
  id: 'grain_list_views',
  name: 'Grain List Views',
  description: 'List available Grain views for webhook subscriptions',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Grain API key (Personal Access Token)',
    },
    typeFilter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional view type filter: recordings, highlights, or stories',
    },
  },

  request: {
    url: (params) =>
      params.typeFilter
        ? `https://api.grain.com/_/public-api/views?type_filter=${encodeURIComponent(params.typeFilter)}`
        : 'https://api.grain.com/_/public-api/views',
    method: 'GET',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || data.message || 'Failed to list views')
    }

    return {
      success: true,
      output: {
        views: data.views || data || [],
      },
    }
  },

  outputs: {
    views: {
      type: 'array',
      description: 'Array of Grain views',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'View UUID' },
          name: { type: 'string', description: 'View name' },
          type: { type: 'string', description: 'View type: recordings, highlights, or stories' },
        },
      },
    },
  },
}
