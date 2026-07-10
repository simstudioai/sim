import type { DubListTagsParams, DubListTagsResponse } from '@/tools/dub/types'
import type { ToolConfig } from '@/tools/types'

export const listTagsTool: ToolConfig<DubListTagsParams, DubListTagsResponse> = {
  id: 'dub_list_tags',
  name: 'Dub List Tags',
  description:
    'Retrieve the tags defined in the workspace, so the right tag IDs can be assigned to links.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Dub API key',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search by tag name',
    },
    sortBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Field to sort by: name (default) or createdAt',
    },
    sortOrder: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort order: asc (default) or desc',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number (default: 1)',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of tags per page (default: 100, max: 100)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.dub.co/tags')
      if (params.search) url.searchParams.set('search', params.search)
      if (params.sortBy) url.searchParams.set('sortBy', params.sortBy)
      if (params.sortOrder) url.searchParams.set('sortOrder', params.sortOrder)
      if (params.page) url.searchParams.set('page', String(params.page))
      if (params.pageSize) url.searchParams.set('pageSize', String(params.pageSize))
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Accept: 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message || data.error || 'Failed to list tags')
    }

    const tags = Array.isArray(data) ? (data as Record<string, unknown>[]) : []

    return {
      success: true,
      output: {
        tags,
        count: tags.length,
      },
    }
  },

  outputs: {
    tags: {
      type: 'json',
      description: 'Array of tag objects (id, name, color)',
    },
    count: { type: 'number', description: 'Number of tags returned' },
  },
}
