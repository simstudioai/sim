import type { ToolConfig } from '@/tools/types'
import type { BoxSearchParams, BoxSearchResponse } from './types'
import { SEARCH_RESULT_OUTPUT_PROPERTIES } from './types'

export const boxSearchTool: ToolConfig<BoxSearchParams, BoxSearchResponse> = {
  id: 'box_search',
  name: 'Box Search',
  description: 'Search for files and folders in Box',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'box',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for Box API',
    },
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The search query string',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results to return',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'The offset for pagination',
    },
    ancestorFolderId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Restrict search to a specific folder and its subfolders',
    },
    fileExtensions: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated file extensions to filter by (e.g., pdf,docx)',
    },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Restrict to a specific content type: file, folder, or web_link',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      queryParams.set('query', params.query)
      if (params.limit !== undefined) queryParams.set('limit', String(params.limit))
      if (params.offset !== undefined) queryParams.set('offset', String(params.offset))
      if (params.ancestorFolderId)
        queryParams.set('ancestor_folder_ids', params.ancestorFolderId.trim())
      if (params.fileExtensions) queryParams.set('file_extensions', params.fileExtensions)
      if (params.type) queryParams.set('type', params.type)
      return `https://api.box.com/2.0/search?${queryParams.toString()}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || `Box API error: ${response.status}`)
    }

    return {
      success: true,
      output: {
        results: (data.entries ?? []).map((item: Record<string, unknown>) => ({
          type: item.type ?? '',
          id: item.id ?? '',
          name: item.name ?? '',
          size: item.size ?? null,
          createdAt: item.created_at ?? null,
          modifiedAt: item.modified_at ?? null,
          parentId: (item.parent as Record<string, unknown> | undefined)?.id ?? null,
          parentName: (item.parent as Record<string, unknown> | undefined)?.name ?? null,
        })),
        totalCount: data.total_count ?? 0,
      },
    }
  },

  outputs: SEARCH_RESULT_OUTPUT_PROPERTIES,
}
